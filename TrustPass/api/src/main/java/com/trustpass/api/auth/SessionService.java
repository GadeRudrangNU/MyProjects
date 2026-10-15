package com.trustpass.api.auth;

import com.trustpass.api.audit.AuditService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.Hashing;
import com.trustpass.api.shared.RequestContext;
import com.trustpass.api.shared.Sql;
import com.trustpass.api.shared.TrustPassProperties;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SessionService {

    private final JdbcClient jdbc;
    private final TrustPassProperties props;
    private final AuditService audit;
    private final Clock clock;

    SessionService(JdbcClient jdbc, TrustPassProperties props, AuditService audit, Clock clock) {
        this.jdbc = jdbc;
        this.props = props;
        this.audit = audit;
        this.clock = clock;
    }

    record Opened(UUID sessionId, String refreshToken) {
    }

    record Rotated(UUID sessionId, UUID userId, String refreshToken) {
    }

    public record SessionView(UUID id, String userAgent, String ip, Instant createdAt, Instant lastSeenAt,
                              boolean current) {
    }

    @Transactional
    Opened open(UUID userId) {
        UUID sessionId = UUID.randomUUID();
        jdbc.sql("insert into sessions (id, user_id, user_agent, ip) values (:id, :user, :ua, :ip)")
                .param("id", sessionId).param("user", userId)
                .param("ua", RequestContext.userAgent()).param("ip", RequestContext.ip())
                .update();
        return new Opened(sessionId, issueRefreshToken(sessionId));
    }

    @Transactional(noRollbackFor = ApiException.class)
    Rotated rotate(String rawToken) {
        var row = jdbc.sql("""
                        select rt.id, rt.session_id, rt.used_at, rt.expires_at, s.user_id, s.revoked_at
                        from refresh_tokens rt join sessions s on s.id = rt.session_id
                        where rt.token_hash = :hash
                        """)
                .param("hash", Hashing.sha256Hex(rawToken))
                .query((rs, n) -> new Object[]{rs.getObject("id", UUID.class), rs.getObject("session_id", UUID.class),
                        rs.getTimestamp("used_at"), rs.getTimestamp("expires_at").toInstant(),
                        rs.getObject("user_id", UUID.class), rs.getTimestamp("revoked_at")})
                .optional()
                .orElseThrow(() -> ApiException.unauthorized("Invalid refresh token"));
        UUID tokenId = (UUID) row[0];
        UUID sessionId = (UUID) row[1];
        UUID userId = (UUID) row[4];
        if (row[2] != null) {
            return reuseDetected(userId, sessionId);
        }
        if (row[5] != null || ((Instant) row[3]).isBefore(clock.instant())) {
            throw ApiException.unauthorized("Session expired");
        }
        int claimed = jdbc.sql("update refresh_tokens set used_at = now() where id = :id and used_at is null")
                .param("id", tokenId).update();
        if (claimed == 0) {
            return reuseDetected(userId, sessionId);
        }
        jdbc.sql("update sessions set last_seen_at = now() where id = :id").param("id", sessionId).update();
        return new Rotated(sessionId, userId, issueRefreshToken(sessionId));
    }

    @Transactional(readOnly = true)
    public boolean isActive(UUID sessionId) {
        return jdbc.sql("select count(*) from sessions where id = :id and revoked_at is null")
                .param("id", sessionId).query(Long.class).single() > 0;
    }

    @Transactional(readOnly = true)
    public List<SessionView> list(UUID userId, UUID currentSessionId) {
        return jdbc.sql("""
                        select id, user_agent, ip, created_at, last_seen_at from sessions
                        where user_id = :user and revoked_at is null order by last_seen_at desc
                        """)
                .param("user", userId)
                .query((rs, n) -> {
                    UUID id = rs.getObject("id", UUID.class);
                    return new SessionView(id, rs.getString("user_agent"), rs.getString("ip"),
                            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("last_seen_at").toInstant(),
                            id.equals(currentSessionId));
                })
                .list();
    }

    @Transactional
    public boolean revoke(UUID userId, UUID sessionId) {
        int updated = jdbc.sql("update sessions set revoked_at = now() where id = :id and user_id = :user and revoked_at is null")
                .param("id", sessionId).param("user", userId).update();
        return updated > 0;
    }

    @Transactional
    public int revokeAll(UUID userId) {
        return jdbc.sql("update sessions set revoked_at = now() where user_id = :user and revoked_at is null")
                .param("user", userId).update();
    }

    private Rotated reuseDetected(UUID userId, UUID sessionId) {
        int revoked = revokeAll(userId);
        audit.recordAs(userId, null, "REFRESH_TOKEN_REUSE", "SESSION", sessionId.toString(),
                Map.of("revokedSessions", revoked));
        throw ApiException.unauthorized("Session expired");
    }

    private String issueRefreshToken(UUID sessionId) {
        String raw = Hashing.randomToken(48);
        jdbc.sql("insert into refresh_tokens (id, session_id, token_hash, expires_at) values (:id, :session, :hash, :exp)")
                .param("id", UUID.randomUUID()).param("session", sessionId)
                .param("hash", Hashing.sha256Hex(raw))
                .param("exp", Sql.ts(clock.instant().plus(props.security().refreshTtl())))
                .update();
        return raw;
    }
}
