package com.trustpass.api.verification;

import com.trustpass.api.audit.AuditService;
import com.trustpass.api.notifications.OutboxService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.Hashing;
import com.trustpass.api.users.User;
import com.trustpass.api.users.UserService;
import com.trustpass.common.FieldCrypto;
import com.trustpass.common.JobType;
import com.trustpass.common.VerificationStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Period;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
class VerificationService {

    private static final long MAX_BYTES = 5L * 1024 * 1024;

    private final VerificationRepository repository;
    private final StorageService storage;
    private final UserService users;
    private final OutboxService outbox;
    private final AuditService audit;
    private final FieldCrypto crypto;

    VerificationService(VerificationRepository repository, StorageService storage, UserService users,
                        OutboxService outbox, AuditService audit, FieldCrypto crypto) {
        this.repository = repository;
        this.storage = storage;
        this.users = users;
        this.outbox = outbox;
        this.audit = audit;
        this.crypto = crypto;
    }

    record Submission(DocumentType docType, String fullName, LocalDate dateOfBirth, String idNumber, LocalDate idExpiry) {
    }

    private record Detected(String contentType, String extension) {
    }

    @Transactional
    Verification submit(UUID userId, Submission form, MultipartFile file) {
        User user = users.get(userId);
        if (user.isIdentityVerified()) {
            throw ApiException.conflict("ALREADY_VERIFIED", "Your identity is already verified");
        }
        if (repository.existsByUserIdAndStatusIn(userId, List.of(VerificationStatus.PENDING, VerificationStatus.IN_REVIEW))) {
            throw ApiException.conflict("VERIFICATION_OPEN", "A verification is already in progress");
        }
        if (!form.dateOfBirth().isBefore(LocalDate.now(ZoneOffset.UTC))) {
            throw ApiException.badRequest("INVALID_DATE_OF_BIRTH", "Date of birth must be in the past");
        }
        byte[] content = read(file);
        Detected detected = detect(content);
        String idNumber = form.idNumber().trim().toUpperCase(Locale.ROOT);

        Verification v = new Verification();
        v.setUserId(userId);
        v.setDocType(form.docType());
        v.setStorageKey(storage.save(content, detected.extension()));
        v.setOriginalFilename(sanitize(file.getOriginalFilename()));
        v.setContentType(detected.contentType());
        v.setFileSha256(Hashing.sha256Hex(content));
        v.setFullName(form.fullName().trim());
        v.setDateOfBirth(form.dateOfBirth().toString());
        v.setIdNumber(idNumber);
        v.setIdNumberFingerprint(crypto.fingerprint(idNumber));
        v.setIdExpiry(form.idExpiry());
        repository.saveAndFlush(v);

        outbox.enqueue(JobType.VERIFICATION_SUBMITTED, Map.of("verificationId", v.getId().toString()));
        audit.record("VERIFICATION_SUBMITTED", "VERIFICATION", v.getId().toString(), Map.of("docType", form.docType().name()));
        return v;
    }

    @Transactional(readOnly = true)
    List<Verification> forUser(UUID userId) {
        return repository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    @Transactional(readOnly = true)
    Page<Verification> queue(VerificationStatus status, int page, int size) {
        return repository.findByStatus(status, PageRequest.of(page, size, Sort.by("createdAt").ascending()));
    }

    @Transactional(readOnly = true)
    Verification get(UUID id) {
        return repository.findById(id).orElseThrow(() -> ApiException.notFound("Verification"));
    }

    @Transactional
    Verification decide(UUID id, boolean approve, String reason, UUID reviewerId) {
        Verification v = repository.lockById(id).orElseThrow(() -> ApiException.notFound("Verification"));
        VerificationStatus target = approve ? VerificationStatus.VERIFIED : VerificationStatus.REJECTED;
        if (!v.getStatus().canMoveTo(target)) {
            throw ApiException.conflict("INVALID_TRANSITION",
                    "Cannot move a verification from " + v.getStatus() + " to " + target);
        }
        if (!approve && (reason == null || reason.isBlank())) {
            throw ApiException.badRequest("REASON_REQUIRED", "A reason is required when rejecting");
        }
        v.setStatus(target);
        v.setReviewerId(reviewerId);
        v.setReviewedAt(Instant.now());
        v.setUpdatedAt(Instant.now());
        v.setRejectReason(approve ? null : reason.trim());
        repository.save(v);

        boolean over21 = Period.between(v.dob(), LocalDate.now(ZoneOffset.UTC)).getYears() >= 21;
        users.applyIdentityResult(v.getUserId(), approve, over21);
        User owner = users.get(v.getUserId());
        outbox.enqueue(JobType.VERIFICATION_DECIDED, Map.of(
                "email", owner.getEmail(),
                "name", owner.getName(),
                "decision", target.name(),
                "reason", v.getRejectReason() == null ? "" : v.getRejectReason()));
        audit.record(approve ? "VERIFICATION_APPROVED" : "VERIFICATION_REJECTED", "VERIFICATION", id.toString(),
                Map.of("userId", v.getUserId().toString()));
        return v;
    }

    byte[] document(UUID id) {
        Verification v = get(id);
        audit.record("VERIFICATION_DOCUMENT_VIEWED", "VERIFICATION", id.toString(), Map.of());
        return storage.load(v.getStorageKey());
    }

    private byte[] read(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw ApiException.badRequest("FILE_REQUIRED", "A document image is required");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new ApiException(org.springframework.http.HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE",
                    "File exceeds the 5 MB limit");
        }
        try {
            return file.getBytes();
        } catch (java.io.IOException e) {
            throw ApiException.badRequest("FILE_UNREADABLE", "The file could not be read");
        }
    }

    private static Detected detect(byte[] c) {
        if (c.length > 4 && (c[0] & 0xFF) == 0xFF && (c[1] & 0xFF) == 0xD8 && (c[2] & 0xFF) == 0xFF) {
            return new Detected("image/jpeg", "jpg");
        }
        if (c.length > 8 && (c[0] & 0xFF) == 0x89 && c[1] == 'P' && c[2] == 'N' && c[3] == 'G') {
            return new Detected("image/png", "png");
        }
        if (c.length > 5 && c[0] == '%' && c[1] == 'P' && c[2] == 'D' && c[3] == 'F') {
            return new Detected("application/pdf", "pdf");
        }
        throw new ApiException(org.springframework.http.HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_FILE_TYPE",
                "Only JPEG, PNG and PDF files are accepted");
    }

    private static String sanitize(String name) {
        if (name == null) {
            return null;
        }
        String clean = name.replaceAll("[^A-Za-z0-9._ -]", "_");
        return clean.length() > 200 ? clean.substring(clean.length() - 200) : clean;
    }
}
