package com.trustpass.api.verification;

import com.trustpass.api.shared.CurrentUser;
import com.trustpass.api.shared.PageResponse;
import com.trustpass.api.users.UserService;
import com.trustpass.common.Masking;
import com.trustpass.common.VerificationStatus;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
class VerificationController {

    private final VerificationService service;
    private final UserService users;

    VerificationController(VerificationService service, UserService users) {
        this.service = service;
        this.users = users;
    }

    @PostMapping(value = "/verifications", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    MemberView submitVerification(@RequestPart("document") MultipartFile document,
                      @RequestParam DocumentType docType,
                      @RequestParam @NotBlank @Size(max = 160) String fullName,
                      @RequestParam LocalDate dateOfBirth,
                      @RequestParam @Pattern(regexp = "[A-Za-z0-9-]{4,40}") String idNumber,
                      @RequestParam LocalDate idExpiry) {
        Verification v = service.submit(CurrentUser.require().id(),
                new VerificationService.Submission(docType, fullName, dateOfBirth, idNumber, idExpiry), document);
        return MemberView.of(v);
    }

    @GetMapping("/verifications/me")
    List<MemberView> listMyVerifications() {
        return service.forUser(CurrentUser.require().id()).stream().map(MemberView::of).toList();
    }

    @GetMapping("/admin/verifications")
    @PreAuthorize("hasAnyRole('ADMIN','REVIEWER')")
    PageResponse<ReviewItem> listVerificationQueue(@RequestParam(defaultValue = "IN_REVIEW") VerificationStatus status,
                                   @RequestParam(defaultValue = "0") int page,
                                   @RequestParam(defaultValue = "25") int size) {
        int safeSize = Math.min(Math.max(size, 1), 100);
        int safePage = Math.max(page, 0);
        var result = service.queue(status, safePage, safeSize);
        return new PageResponse<>(result.map(this::reviewItem).getContent(), safePage, safeSize, result.getTotalElements());
    }

    @GetMapping("/admin/verifications/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','REVIEWER')")
    ReviewItem getVerification(@PathVariable UUID id) {
        return reviewItem(service.get(id));
    }

    @GetMapping(value = "/admin/verifications/{id}/document", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN','REVIEWER')")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200",
            content = @Content(mediaType = "application/octet-stream", schema = @Schema(type = "string", format = "binary")))
    ResponseEntity<byte[]> downloadVerificationDocument(@PathVariable UUID id) {
        Verification v = service.get(id);
        byte[] bytes = service.document(id);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(v.getContentType())).body(bytes);
    }

    @PostMapping("/admin/verifications/{id}/decision")
    @PreAuthorize("hasAnyRole('ADMIN','REVIEWER')")
    ReviewItem decideVerification(@PathVariable UUID id, @Valid @RequestBody Decision body) {
        Verification v = service.decide(id, body.decision() == Outcome.APPROVE, body.reason(), CurrentUser.require().id());
        return reviewItem(v);
    }

    private ReviewItem reviewItem(Verification v) {
        var owner = users.get(v.getUserId());
        return new ReviewItem(v.getId(), v.getStatus(), owner.getId(), owner.getEmail(), owner.getName(), v.getFullName(),
                v.dob(), Masking.keepLast(v.getIdNumber(), 4), v.getDocType(), v.getIdExpiry(), v.getFlags(),
                v.getRejectReason(), v.getContentType(), v.getCreatedAt());
    }

    enum Outcome {
        APPROVE,
        REJECT
    }

    record Decision(@NotNull Outcome decision, @Size(max = 500) String reason) {
    }

    record MemberView(UUID id, VerificationStatus status, DocumentType docType, String rejectReason, Instant createdAt,
                      Instant updatedAt) {

        static MemberView of(Verification v) {
            return new MemberView(v.getId(), v.getStatus(), v.getDocType(), v.getRejectReason(), v.getCreatedAt(),
                    v.getUpdatedAt());
        }
    }

    record ReviewItem(UUID id, VerificationStatus status, UUID userId, String userEmail, String accountName,
                      String fullName, LocalDate dateOfBirth, String idNumberMasked, DocumentType docType,
                      LocalDate idExpiry, List<String> flags, String rejectReason, String contentType,
                      Instant createdAt) {
    }
}
