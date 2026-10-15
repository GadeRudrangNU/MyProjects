package com.trustpass.api.admin;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class MetricsController {

    private final JdbcClient jdbc;

    MetricsController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/admin/metrics/summary")
    @PreAuthorize("hasAnyRole('ADMIN','SUPPORT')")
    Summary getMetricsSummary() {
        long users = count("select count(*) from users");
        long verified = count("select count(*) from verifications where status = 'VERIFIED'");
        long rejected = count("select count(*) from verifications where status = 'REJECTED'");
        double passRate = verified + rejected == 0 ? 0 : (double) verified / (verified + rejected);
        return new Summary(
                users,
                count("select count(*) from subscriptions where status = 'ACTIVE'"),
                count("select count(*) from bookings where status = 'CONFIRMED'"),
                passRate,
                perDay("users", "created_at", ""),
                perDay("login_events", "at", "and t.success = false"),
                grouped("select status as k, count(*) as v from verifications group by status"),
                jdbc.sql("""
                                select l.name, count(b.id) as bookings
                                from locations l
                                left join slots s on s.location_id = l.id
                                left join bookings b on b.slot_id = s.id and b.status = 'CONFIRMED'
                                group by l.id, l.name order by l.name
                                """)
                        .query((rs, n) -> new LocationCount(rs.getString("name"), rs.getLong("bookings"))).list(),
                grouped("select status as k, count(*) as v from outbox_jobs group by status"));
    }

    private long count(String sql) {
        return jdbc.sql(sql).query(Long.class).single();
    }

    private List<DayCount> perDay(String table, String column, String extra) {
        return jdbc.sql("""
                        select d::date as day, count(t.*) as total
                        from generate_series(current_date - 13, current_date, interval '1 day') d
                        left join %s t on t.%s::date = d::date %s
                        group by d order by d
                        """.formatted(table, column, extra))
                .query((rs, n) -> new DayCount(rs.getDate("day").toLocalDate(), rs.getLong("total"))).list();
    }

    private Map<String, Long> grouped(String sql) {
        Map<String, Long> out = new LinkedHashMap<>();
        jdbc.sql(sql).query(rs -> {
            out.put(rs.getString("k"), rs.getLong("v"));
        });
        return out;
    }

    record DayCount(LocalDate day, long count) {
    }

    record LocationCount(String location, long bookings) {
    }

    record Summary(long totalUsers, long activeMemberships, long confirmedBookings, double verificationPassRate,
                   List<DayCount> signupsPerDay, List<DayCount> failedLoginsPerDay,
                   Map<String, Long> verificationsByStatus, List<LocationCount> bookingsPerLocation,
                   Map<String, Long> jobsByStatus) {
    }
}
