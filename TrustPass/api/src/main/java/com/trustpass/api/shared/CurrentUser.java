package com.trustpass.api.shared;

import java.util.Optional;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

public record CurrentUser(UUID id, String email, Role role, UUID sessionId) {

    public static Optional<CurrentUser> find() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt) || jwt.getClaimAsString("sid") == null) {
            return Optional.empty();
        }
        return Optional.of(new CurrentUser(
                UUID.fromString(jwt.getSubject()),
                jwt.getClaimAsString("email"),
                Role.valueOf(jwt.getClaimAsString("role")),
                UUID.fromString(jwt.getClaimAsString("sid"))));
    }

    public static CurrentUser require() {
        return find().orElseThrow(() -> ApiException.unauthorized("Authentication required"));
    }

    public boolean has(Role... roles) {
        for (Role r : roles) {
            if (r == role) {
                return true;
            }
        }
        return false;
    }
}
