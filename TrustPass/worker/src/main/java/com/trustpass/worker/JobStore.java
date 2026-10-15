package com.trustpass.worker;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trustpass.common.Backoff;
import com.trustpass.common.JobType;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class JobStore {

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;

    JobStore(JdbcClient jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public List<Job> claim(String workerId, int limit) {
        return jdbc.sql("""
                        update outbox_jobs
                        set status = 'RUNNING', locked_by = :worker, locked_at = now(), attempts = attempts + 1
                        where id in (
                            select id from outbox_jobs
                            where status = 'PENDING' and next_run_at <= now()
                            order by next_run_at, id
                            for update skip locked
                            limit :limit)
                        returning id, type, payload::text as payload, attempts, trace_id
                        """)
                .param("worker", workerId)
                .param("limit", limit)
                .query((rs, n) -> new Job(rs.getLong("id"), JobType.valueOf(rs.getString("type")),
                        parse(rs.getString("payload")), rs.getInt("attempts"), rs.getString("trace_id")))
                .list();
    }

    public void markDone(long id) {
        jdbc.sql("update outbox_jobs set status = 'DONE', finished_at = now(), last_error = null, locked_by = null where id = :id")
                .param("id", id).update();
    }

    public boolean markFailed(Job job, String error) {
        String message = error == null ? "unknown error" : error.substring(0, Math.min(error.length(), 1000));
        if (Backoff.exhausted(job.attempts())) {
            jdbc.sql("update outbox_jobs set status = 'DEAD', finished_at = now(), last_error = :err, locked_by = null where id = :id")
                    .param("err", message).param("id", job.id()).update();
            return true;
        }
        jdbc.sql("""
                        update outbox_jobs
                        set status = 'PENDING', last_error = :err, locked_by = null,
                            next_run_at = now() + make_interval(secs => :delay)
                        where id = :id
                        """)
                .param("err", message)
                .param("delay", (double) Backoff.delayAfter(job.attempts()).toSeconds())
                .param("id", job.id()).update();
        return false;
    }

    public int requeueStale(int minutes) {
        return jdbc.sql("""
                        update outbox_jobs set status = 'PENDING', locked_by = null
                        where status = 'RUNNING' and locked_at < now() - make_interval(mins => :minutes)
                        """)
                .param("minutes", minutes).update();
    }

    private com.fasterxml.jackson.databind.JsonNode parse(String json) {
        try {
            return mapper.readTree(json);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("corrupt job payload", e);
        }
    }
}
