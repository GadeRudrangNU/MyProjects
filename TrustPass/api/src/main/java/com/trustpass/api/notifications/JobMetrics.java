package com.trustpass.api.notifications;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class JobMetrics {

    JobMetrics(MeterRegistry registry, JdbcClient jdbc) {
        Gauge.builder("trustpass.jobs.backlog", () -> count(jdbc, "PENDING"))
                .description("Jobs waiting to be processed").register(registry);
        Gauge.builder("trustpass.jobs.dead", () -> count(jdbc, "DEAD"))
                .description("Jobs that exhausted their retries").register(registry);
    }

    private static double count(JdbcClient jdbc, String status) {
        try {
            return jdbc.sql("select count(*) from outbox_jobs where status = :s").param("s", status)
                    .query(Long.class).single();
        } catch (RuntimeException e) {
            return Double.NaN;
        }
    }
}
