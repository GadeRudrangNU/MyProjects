package com.trustpass.api.users;

import com.trustpass.api.shared.EncryptedStringConverter;
import com.trustpass.api.shared.Role;
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
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private String email;

    private String name;

    @Column(name = "password_hash")
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    private Role role = Role.MEMBER;

    @Column(name = "email_verified")
    private boolean emailVerified;

    @Column(name = "mfa_enabled")
    private boolean mfaEnabled;

    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "mfa_secret")
    private String mfaSecret;

    @Column(name = "failed_attempts")
    private int failedAttempts;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    @Column(name = "identity_verified")
    private boolean identityVerified;

    @Column(name = "age_over_21")
    private boolean ageOver21;

    @Column(name = "created_at")
    private Instant createdAt = Instant.now();

    public boolean isLocked(Instant now) {
        return lockedUntil != null && lockedUntil.isAfter(now);
    }
}
