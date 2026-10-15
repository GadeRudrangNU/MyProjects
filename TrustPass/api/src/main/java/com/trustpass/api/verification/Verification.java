package com.trustpass.api.verification;

import com.trustpass.api.shared.EncryptedStringConverter;
import com.trustpass.common.VerificationStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "verifications")
@Getter
@Setter
@NoArgsConstructor
class Verification {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id")
    private UUID userId;

    @Enumerated(EnumType.STRING)
    private VerificationStatus status = VerificationStatus.PENDING;

    @Column(name = "doc_type")
    @Enumerated(EnumType.STRING)
    private DocumentType docType;

    @Column(name = "storage_key")
    private String storageKey;

    @Column(name = "original_filename")
    private String originalFilename;

    @Column(name = "content_type")
    private String contentType;

    @Column(name = "file_sha256")
    private String fileSha256;

    @Column(name = "full_name")
    private String fullName;

    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "dob_enc")
    private String dateOfBirth;

    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "id_number_enc")
    private String idNumber;

    @Column(name = "id_number_fp")
    private String idNumberFingerprint;

    @Column(name = "id_expiry")
    private LocalDate idExpiry;

    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> flags = new ArrayList<>();

    @Column(name = "reject_reason")
    private String rejectReason;

    @Column(name = "reviewer_id")
    private UUID reviewerId;

    @Column(name = "created_at")
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at")
    private Instant updatedAt = Instant.now();

    @Column(name = "reviewed_at")
    private Instant reviewedAt;

    LocalDate dob() {
        return LocalDate.parse(dateOfBirth);
    }
}
