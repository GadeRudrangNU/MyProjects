package com.trustpass.api.auth;

import com.trustpass.api.audit.AuditService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.RequestContext;
import com.trustpass.api.shared.TrustPassProperties;
import com.trustpass.api.users.User;
import com.trustpass.api.users.UserService;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final UserService users;
    private final PasswordHasher hasher;
    private final SessionService sessions;
    private final TokenService tokens;
    private final MfaService mfa;
    private final RateLimiter limiter;
    private final LoginEvents events;
    private final AuditService audit;
    private final EmailVerificationService emailVerification;
    private final TrustPassProperties props;
    private final Clock clock;

    AuthService(UserService users, PasswordHasher hasher, SessionService sessions, TokenService tokens, MfaService mfa,
                RateLimiter limiter, LoginEvents events, AuditService audit,
                EmailVerificationService emailVerification, TrustPassProperties props, Clock clock) {
        this.users = users;
        this.hasher = hasher;
        this.sessions = sessions;
        this.tokens = tokens;
        this.mfa = mfa;
        this.limiter = limiter;
        this.events = events;
        this.audit = audit;
        this.emailVerification = emailVerification;
        this.props = props;
        this.clock = clock;
    }

    record Authenticated(User user, String accessToken, String refreshToken, long expiresIn) {
    }

    record LoginOutcome(Authenticated authenticated, String mfaToken) {
    }

    @Transactional
    void signup(String name, String email, String password) {
        limiter.check("signup:ip:" + RequestContext.ip(), props.rateLimit().signupPerIpPerHour(), Duration.ofHours(1));
        if (users.findByEmail(email).isPresent()) {
            audit.recordAs(null, UserService.normalizeEmail(email), "SIGNUP_DUPLICATE", "USER", null, Map.of());
            return;
        }
        User user = users.create(name, email, hasher.hash(password), false);
        emailVerification.issue(user);
        audit.recordAs(user.getId(), user.getEmail(), "SIGNUP", "USER", user.getId().toString(), Map.of());
    }

    @Transactional(noRollbackFor = ApiException.class)
    LoginOutcome login(String email, String password) {
        String normalized = UserService.normalizeEmail(email);
        limiter.check("login:ip:" + RequestContext.ip(), props.rateLimit().loginPerIpPerMinute(), Duration.ofMinutes(1));
        limiter.check("login:email:" + normalized, props.rateLimit().loginPerEmailPerMinute(), Duration.ofMinutes(1));
        User user = authenticatePassword(normalized, password);
        if (user.isMfaEnabled()) {
            return new LoginOutcome(null, tokens.mfaChallenge(user.getId()));
        }
        return new LoginOutcome(complete(user), null);
    }

    @Transactional(noRollbackFor = ApiException.class)
    public User authenticatePassword(String normalizedEmail, String password) {
        User user = users.findByEmail(normalizedEmail).orElse(null);
        if (user == null || user.getPasswordHash() == null) {
            hasher.spendTime(password);
            events.failure(normalizedEmail, "unknown_or_no_password");
            throw invalid();
        }
        if (user.isLocked(clock.instant())) {
            events.failure(normalizedEmail, "locked");
            throw new ApiException(HttpStatus.LOCKED, "ACCOUNT_LOCKED",
                    "Too many failed attempts. Try again later or contact support.");
        }
        if (!hasher.matches(password, user.getPasswordHash())) {
            registerFailure(user, "bad_password");
            throw invalid();
        }
        if (!user.isEmailVerified()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "EMAIL_NOT_VERIFIED", "Verify your email address before signing in");
        }
        user.setFailedAttempts(0);
        user.setLockedUntil(null);
        users.save(user);
        return user;
    }

    @Transactional(noRollbackFor = ApiException.class)
    Authenticated mfaVerify(String mfaToken, String code) {
        Jwt jwt = tokens.parse(mfaToken, TokenService.PURPOSE_MFA);
        User user = users.get(UUID.fromString(jwt.getSubject()));
        limiter.check("mfa:user:" + user.getId(), props.rateLimit().loginPerEmailPerMinute(), Duration.ofMinutes(1));
        if (user.isLocked(clock.instant())) {
            throw new ApiException(HttpStatus.LOCKED, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.");
        }
        if (!mfa.verifyCode(user, code)) {
            registerFailure(user, "bad_mfa_code");
            throw ApiException.unauthorized("The code is not valid");
        }
        user.setFailedAttempts(0);
        users.save(user);
        return complete(user);
    }

    @Transactional
    public Authenticated complete(User user) {
        SessionService.Opened opened = sessions.open(user.getId());
        events.success(user.getEmail());
        audit.recordAs(user.getId(), user.getEmail(), "LOGIN", "SESSION", opened.sessionId().toString(), Map.of());
        return new Authenticated(user, tokens.access(user, opened.sessionId()), opened.refreshToken(),
                tokens.accessTtl().toSeconds());
    }

    @Transactional(noRollbackFor = ApiException.class)
    Authenticated refresh(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw ApiException.unauthorized("Missing refresh token");
        }
        SessionService.Rotated rotated = sessions.rotate(refreshToken);
        User user = users.get(rotated.userId());
        return new Authenticated(user, tokens.access(user, rotated.sessionId()), rotated.refreshToken(),
                tokens.accessTtl().toSeconds());
    }

    @Transactional
    void logout(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            return;
        }
        try {
            SessionService.Rotated rotated = sessions.rotate(refreshToken);
            sessions.revoke(rotated.userId(), rotated.sessionId());
            audit.recordAs(rotated.userId(), null, "LOGOUT", "SESSION", rotated.sessionId().toString(), Map.of());
        } catch (ApiException ignored) {
        }
    }

    private void registerFailure(User user, String reason) {
        int attempts = user.getFailedAttempts() + 1;
        user.setFailedAttempts(attempts);
        if (attempts >= props.security().maxFailedAttempts()) {
            user.setLockedUntil(clock.instant().plus(props.security().lockDuration()));
            user.setFailedAttempts(0);
            audit.recordAs(user.getId(), user.getEmail(), "ACCOUNT_LOCKED", "USER", user.getId().toString(), Map.of());
        }
        users.save(user);
        events.failure(user.getEmail(), reason);
    }

    private ApiException invalid() {
        return ApiException.unauthorized("Invalid email or password");
    }
}
