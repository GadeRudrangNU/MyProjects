package com.trustpass.api.users;

import com.trustpass.api.shared.Role;
import java.time.Instant;
import java.util.UUID;

public record UserView(UUID id, String email, String name, Role role, boolean emailVerified, boolean mfaEnabled,
                       boolean identityVerified, boolean ageOver21, boolean locked, Instant createdAt) {

    public static UserView of(User u) {
        return new UserView(u.getId(), u.getEmail(), u.getName(), u.getRole(), u.isEmailVerified(), u.isMfaEnabled(),
                u.isIdentityVerified(), u.isAgeOver21(), u.isLocked(Instant.now()), u.getCreatedAt());
    }
}
