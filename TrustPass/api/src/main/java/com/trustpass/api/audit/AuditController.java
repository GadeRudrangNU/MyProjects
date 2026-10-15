package com.trustpass.api.audit;

import com.trustpass.api.shared.PageResponse;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/audit-log")
class AuditController {

    private final JdbcClient jdbc;

    AuditController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    PageResponse<AuditEntry> listAuditLog(@RequestParam(defaultValue = "0") int page,
                                  @RequestParam(defaultValue = "50") int size,
                                  @RequestParam(required = false) String action) {
        int safeSize = Math.min(Math.max(size, 1), 200);
        int safePage = Math.max(page, 0);
        String filter = action == null || action.isBlank() ? "" : "where action = :action";
        var count = jdbc.sql("select count(*) from audit_log " + filter);
        var query = jdbc.sql("""
                select id, at, actor_id::text as actor_id, actor_email, action, target_type, target_id, ip, details::text as details
                from audit_log %s order by id desc limit :limit offset :offset
                """.formatted(filter));
        if (!filter.isEmpty()) {
            count = count.param("action", action);
            query = query.param("action", action);
        }
        long total = count.query(Long.class).single();
        List<AuditEntry> items = query.param("limit", safeSize).param("offset", safePage * safeSize)
                .query((rs, n) -> new AuditEntry(rs.getLong("id"), rs.getTimestamp("at").toInstant(),
                        rs.getString("actor_id"), rs.getString("actor_email"), rs.getString("action"),
                        rs.getString("target_type"), rs.getString("target_id"), rs.getString("ip"),
                        rs.getString("details")))
                .list();
        return new PageResponse<>(items, safePage, safeSize, total);
    }

    record AuditEntry(long id, Instant at, String actorId, String actorEmail, String action, String targetType,
                      String targetId, String ip, String details) {
    }
}
