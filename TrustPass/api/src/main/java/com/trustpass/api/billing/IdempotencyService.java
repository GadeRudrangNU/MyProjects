package com.trustpass.api.billing;

import com.trustpass.api.shared.ApiException;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
class IdempotencyService {

    record Stored(int status, String body) {
    }

    private final JdbcClient jdbc;

    IdempotencyService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    Optional<Stored> claim(UUID userId, String key, String requestHash) {
        int inserted = jdbc.sql("""
                        insert into idempotency_keys (user_id, key, request_hash, status)
                        values (:user, :key, :hash, 'IN_PROGRESS') on conflict do nothing
                        """)
                .param("user", userId).param("key", key).param("hash", requestHash).update();
        if (inserted == 1) {
            return Optional.empty();
        }
        var existing = jdbc.sql("""
                        select request_hash, status, response_status, response_body,
                               created_at < now() - interval '2 minutes' as stale
                        from idempotency_keys where user_id = :user and key = :key
                        """)
                .param("user", userId).param("key", key)
                .query((rs, n) -> new Object[]{rs.getString("request_hash"), rs.getString("status"),
                        rs.getObject("response_status"), rs.getString("response_body"), rs.getBoolean("stale")})
                .single();
        if (!requestHash.equals(existing[0])) {
            throw new ApiException(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY, "IDEMPOTENCY_KEY_REUSED",
                    "This Idempotency-Key was already used with a different request");
        }
        if ("COMPLETED".equals(existing[1])) {
            return Optional.of(new Stored((Integer) existing[2], (String) existing[3]));
        }
        if ((Boolean) existing[4]) {
            jdbc.sql("update idempotency_keys set created_at = now() where user_id = :user and key = :key")
                    .param("user", userId).param("key", key).update();
            return Optional.empty();
        }
        throw ApiException.conflict("REQUEST_IN_PROGRESS", "A request with this Idempotency-Key is still being processed");
    }

    @Transactional(propagation = Propagation.MANDATORY)
    void complete(UUID userId, String key, int status, String body) {
        jdbc.sql("""
                        update idempotency_keys set status = 'COMPLETED', response_status = :status, response_body = :body
                        where user_id = :user and key = :key
                        """)
                .param("status", status).param("body", body).param("user", userId).param("key", key).update();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void release(UUID userId, String key) {
        jdbc.sql("delete from idempotency_keys where user_id = :user and key = :key and status = 'IN_PROGRESS'")
                .param("user", userId).param("key", key).update();
    }
}
