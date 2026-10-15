package com.trustpass.api.notifications;

import com.trustpass.api.audit.AuditService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.PageResponse;
import com.trustpass.common.JobStatus;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/jobs")
class JobAdminController {

    private final JdbcClient jdbc;
    private final AuditService audit;

    JobAdminController(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','SUPPORT')")
    PageResponse<JobView> listJobs(@RequestParam(defaultValue = "DEAD") JobStatus status,
                               @RequestParam(defaultValue = "0") int page,
                               @RequestParam(defaultValue = "25") int size) {
        int safeSize = Math.min(Math.max(size, 1), 100);
        int safePage = Math.max(page, 0);
        long total = jdbc.sql("select count(*) from outbox_jobs where status = :s")
                .param("s", status.name()).query(Long.class).single();
        List<JobView> items = jdbc.sql("""
                        select id, type, status, attempts, next_run_at, last_error, trace_id, created_at
                        from outbox_jobs where status = :s order by id desc limit :limit offset :offset
                        """)
                .param("s", status.name())
                .param("limit", safeSize)
                .param("offset", safePage * safeSize)
                .query((rs, n) -> new JobView(rs.getLong("id"), rs.getString("type"), rs.getString("status"),
                        rs.getInt("attempts"), rs.getTimestamp("next_run_at").toInstant(), rs.getString("last_error"),
                        rs.getString("trace_id"), rs.getTimestamp("created_at").toInstant()))
                .list();
        return new PageResponse<>(items, safePage, safeSize, total);
    }

    @PostMapping("/{id}/retry")
    @PreAuthorize("hasAnyRole('ADMIN','SUPPORT')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    void retryJob(@PathVariable long id) {
        int updated = jdbc.sql("""
                        update outbox_jobs set status = 'PENDING', attempts = 0, next_run_at = now(), last_error = null,
                               locked_by = null, locked_at = null, finished_at = null
                        where id = :id and status = 'DEAD'
                        """)
                .param("id", id).update();
        if (updated == 0) {
            throw ApiException.conflict("JOB_NOT_DEAD", "Only dead jobs can be retried");
        }
        audit.record("JOB_RETRIED", "JOB", String.valueOf(id), Map.of());
    }

    record JobView(long id, String type, String status, int attempts, Instant nextRunAt, String lastError,
                   String traceId, Instant createdAt) {
    }
}
