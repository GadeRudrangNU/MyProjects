package com.trustpass.api.auth;

import com.trustpass.api.audit.AuditService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.users.User;
import com.trustpass.api.users.UserService;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class OAuthAccountService {

    record Profile(String provider, String subject, String email, boolean emailVerified, String name) {
    }

    record Resolution(User user, String linkToken, String error) {
    }

    private final JdbcClient jdbc;
    private final UserService users;
    private final AuthService auth;
    private final TokenService tokens;
    private final PasswordHasher hasher;
    private final AuditService audit;

    OAuthAccountService(JdbcClient jdbc, UserService users, AuthService auth, TokenService tokens,
                        PasswordHasher hasher, AuditService audit) {
        this.jdbc = jdbc;
        this.users = users;
        this.auth = auth;
        this.tokens = tokens;
        this.hasher = hasher;
        this.audit = audit;
    }

    @Transactional
    Resolution resolve(Profile profile) {
        Optional<UUID> linked = jdbc.sql("select user_id from oauth_identities where provider = :p and subject = :s")
                .param("p", profile.provider()).param("s", profile.subject())
                .query((rs, n) -> rs.getObject("user_id", UUID.class)).optional();
        if (linked.isPresent()) {
            return new Resolution(users.get(linked.get()), null, null);
        }
        if (!profile.emailVerified() || profile.email() == null) {
            return new Resolution(null, null, "unverified_email");
        }
        Optional<User> existing = users.findByEmail(profile.email());
        if (existing.isPresent()) {
            String token = tokens.linkChallenge(existing.get().getId(), profile.provider(), profile.subject(), profile.email());
            return new Resolution(null, token, null);
        }
        String name = profile.name() == null || profile.name().isBlank() ? profile.email() : profile.name();
        User user = users.create(name, profile.email(), null, true);
        attach(user, profile.provider(), profile.subject(), profile.email());
        audit.recordAs(user.getId(), user.getEmail(), "SIGNUP_OAUTH", "USER", user.getId().toString(),
                Map.of("provider", profile.provider()));
        return new Resolution(user, null, null);
    }

    @Transactional(noRollbackFor = ApiException.class)
    AuthService.LoginOutcome confirmLink(String linkToken, String password) {
        Jwt jwt = tokens.parse(linkToken, TokenService.PURPOSE_LINK);
        User user = users.get(UUID.fromString(jwt.getSubject()));
        if (!hasher.matches(password, user.getPasswordHash())) {
            throw ApiException.unauthorized("Invalid password");
        }
        attach(user, jwt.getClaimAsString("provider"), jwt.getClaimAsString("external"), jwt.getClaimAsString("email"));
        audit.recordAs(user.getId(), user.getEmail(), "OAUTH_LINKED", "USER", user.getId().toString(),
                Map.of("provider", jwt.getClaimAsString("provider")));
        return outcomeFor(user);
    }

    AuthService.LoginOutcome outcomeFor(User user) {
        if (user.isMfaEnabled()) {
            return new AuthService.LoginOutcome(null, tokens.mfaChallenge(user.getId()));
        }
        return new AuthService.LoginOutcome(auth.complete(user), null);
    }

    private void attach(User user, String provider, String subject, String email) {
        jdbc.sql("insert into oauth_identities (id, user_id, provider, subject, email) values (:id, :u, :p, :s, :e)")
                .param("id", UUID.randomUUID()).param("u", user.getId()).param("p", provider)
                .param("s", subject).param("e", email).update();
        if (!user.isEmailVerified()) {
            user.setEmailVerified(true);
            users.save(user);
        }
    }
}
