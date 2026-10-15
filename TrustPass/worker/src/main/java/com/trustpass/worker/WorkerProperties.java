package com.trustpass.worker;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("trustpass")
public record WorkerProperties(
        @DefaultValue Db db,
        @DefaultValue Jobs jobs,
        @DefaultValue Mail mail,
        @DefaultValue("dev-only-encryption-secret-change-me") String encryptionKey,
        @DefaultValue("http://localhost:5173") String frontendUrl) {

    public record Db(
            @DefaultValue("5434") int port,
            @DefaultValue("120") int waitSeconds,
            @DefaultValue("5") int poolSize) {
    }

    public record Jobs(
            @DefaultValue("10") int batchSize,
            @DefaultValue("5") int staleMinutes) {
    }

    public record Mail(
            @DefaultValue("true") boolean embedded,
            @DefaultValue("3025") int smtpPort,
            @DefaultValue("TrustPass <no-reply@trustpass.dev>") String from) {
    }
}
