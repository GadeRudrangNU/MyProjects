package com.trustpass.api.shared;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("trustpass")
public record TrustPassProperties(
        @DefaultValue Db db,
        @DefaultValue Security security,
        @DefaultValue RateLimit rateLimit,
        @DefaultValue Payment payment,
        @DefaultValue Storage storage,
        @DefaultValue Cors cors,
        @DefaultValue Seed seed,
        @DefaultValue("http://localhost:5173") String frontendUrl) {

    public record Db(
            @DefaultValue("true") boolean embedded,
            @DefaultValue("5434") int port,
            @DefaultValue(".data/pg") String dataDir) {
    }

    public record Security(
            @DefaultValue("dev-only-signing-secret-change-me-0123456789abcdef") String jwtSecret,
            @DefaultValue("dev-only-encryption-secret-change-me") String encryptionKey,
            @DefaultValue("15m") Duration accessTtl,
            @DefaultValue("7d") Duration refreshTtl,
            @DefaultValue("false") boolean cookieSecure,
            @DefaultValue("5") int maxFailedAttempts,
            @DefaultValue("15m") Duration lockDuration,
            @DefaultValue("http://localhost:8080") String issuer) {
    }

    public record RateLimit(
            @DefaultValue("true") boolean enabled,
            @DefaultValue("30") int loginPerIpPerMinute,
            @DefaultValue("10") int loginPerEmailPerMinute,
            @DefaultValue("20") int signupPerIpPerHour) {
    }

    public record Payment(
            @DefaultValue("0.15") double declineRate,
            @DefaultValue("0.10") double outageRate,
            @DefaultValue("50") int minLatencyMs,
            @DefaultValue("600") int maxLatencyMs,
            @DefaultValue("2500") int timeoutMs) {
    }

    public record Storage(
            @DefaultValue("uploads") String path,
            @DefaultValue("5242880") long maxBytes) {
    }

    public record Cors(
            @DefaultValue({"http://localhost:5173", "http://localhost:5174"}) List<String> allowedOrigins) {
    }

    public record Seed(@DefaultValue("false") boolean enabled, @DefaultValue("false") boolean loadUsers) {
    }
}
