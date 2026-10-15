package com.trustpass.api.auth;

import com.trustpass.api.audit.AuditService;
import com.trustpass.api.notifications.OutboxService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.Hashing;
import com.trustpass.api.shared.Sql;
import com.trustpass.api.users.User;
import com.trustpass.api.users.UserService;
import com.trustpass.common.JobType;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class EmailVerificationService {

    private static final Duration TTL = Duration.ofHours(24);

    private final JdbcClient jdbc;
    private final OutboxService outbox;
    private final UserService users;
    private final AuditService audit;
    private final Clock clock;

    EmailVerificationService(JdbcClient jdbc, OutboxService outbox, UserService users, AuditService audit, Clock clock) {
        this.jdbc = jdbc;
        this.outbox = outbox;
        this.users = users;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    void issue(User user) {
        String token = Hashing.randomToken(32);
        jdbc.sql("insert into email_verification_tokens (id, user_id, token_hash, expires_at) values (:id, :user, :hash, :exp)")
                .param("id", UUID.randomUUID()).param("user", user.getId())
                .param("hash", Hashing.sha256Hex(token))
                .param("exp", Sql.ts(clock.instant().plus(TTL)))
                .update();
        outbox.enqueue(JobType.EMAIL_VERIFICATION, Map.of(
                "email", user.getEmail(),
                "name", user.getName(),
                "token", outbox.seal(token)));
    }

    @Transactional(noRollbackFor = ApiException.class)
    void verify(String token) {
        var row = jdbc.sql("select id, user_id, expires_at, used_at from email_verification_tokens where token_hash = :hash")
                .param("hash", Hashing.sha256Hex(token))
                .query((rs, n) -> new Object[]{rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                        rs.getTimestamp("expires_at").toInstant(), rs.getTimestamp("used_at")})
                .optional()
                .orElseThrow(() -> ApiException.badRequest("INVALID_TOKEN", "The verification link is not valid"));
        if (row[3] != null) {
            throw ApiException.badRequest("TOKEN_USED", "This verification link was already used");
        }
        if (((Instant) row[2]).isBefore(clock.instant())) {
            throw ApiException.badRequest("TOKEN_EXPIRED", "The verification link has expired");
        }
        jdbc.sql("update email_verification_tokens set used_at = now() where id = :id").param("id", row[0]).update();
        User user = users.get((UUID) row[1]);
        user.setEmailVerified(true);
        users.save(user);
        audit.recordAs(user.getId(), user.getEmail(), "EMAIL_VERIFIED", "USER", user.getId().toString(), Map.of());
    }

    @Transactional
    void resend(String email) {
        users.findByEmail(email).filter(u -> !u.isEmailVerified()).ifPresent(u -> {
            jdbc.sql("update email_verification_tokens set used_at = now() where user_id = :user and used_at is null")
                    .param("user", u.getId()).update();
            issue(u);
        });
    }
}
