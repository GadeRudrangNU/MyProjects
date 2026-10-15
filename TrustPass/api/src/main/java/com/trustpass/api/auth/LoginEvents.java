package com.trustpass.api.auth;

import com.trustpass.api.shared.RequestContext;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class LoginEvents {

    private final JdbcClient jdbc;
    private final MeterRegistry metrics;

    LoginEvents(JdbcClient jdbc, MeterRegistry metrics) {
        this.jdbc = jdbc;
        this.metrics = metrics;
    }

    void success(String email) {
        insert(email, true, null);
        metrics.counter("trustpass.login", "outcome", "success").increment();
    }

    void failure(String email, String reason) {
        insert(email, false, reason);
        metrics.counter("trustpass.login", "outcome", "failure", "reason", reason).increment();
    }

    private void insert(String email, boolean success, String reason) {
        jdbc.sql("insert into login_events (email, ip, success, reason) values (:email, :ip, :success, :reason)")
                .param("email", email).param("ip", RequestContext.ip())
                .param("success", success).param("reason", reason)
                .update();
    }
}
