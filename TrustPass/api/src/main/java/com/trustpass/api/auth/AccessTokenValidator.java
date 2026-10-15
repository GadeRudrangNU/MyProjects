package com.trustpass.api.auth;

import java.util.UUID;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

class AccessTokenValidator implements OAuth2TokenValidator<Jwt> {

    private static final OAuth2Error INVALID = new OAuth2Error("invalid_token", "Token is not an active access token", null);
    private final SessionService sessions;

    AccessTokenValidator(SessionService sessions) {
        this.sessions = sessions;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        if (!TokenService.ISSUER.equals(jwt.getClaimAsString("iss"))
                || !TokenService.PURPOSE_ACCESS.equals(jwt.getClaimAsString("purpose"))) {
            return OAuth2TokenValidatorResult.failure(INVALID);
        }
        String sid = jwt.getClaimAsString("sid");
        try {
            if (sid == null || !sessions.isActive(UUID.fromString(sid))) {
                return OAuth2TokenValidatorResult.failure(INVALID);
            }
        } catch (IllegalArgumentException e) {
            return OAuth2TokenValidatorResult.failure(INVALID);
        }
        return OAuth2TokenValidatorResult.success();
    }
}
