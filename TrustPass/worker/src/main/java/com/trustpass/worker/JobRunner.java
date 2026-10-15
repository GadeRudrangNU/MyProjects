package com.trustpass.worker;

import com.trustpass.common.JobType;
import io.micrometer.core.instrument.MeterRegistry;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class JobRunner {

    private static final Logger log = LoggerFactory.getLogger(JobRunner.class);

    private final JobStore store;
    private final WorkerProperties props;
    private final MeterRegistry metrics;
    private final Map<JobType, JobHandler> handlers = new EnumMap<>(JobType.class);
    private final String workerId = hostname() + "-" + UUID.randomUUID().toString().substring(0, 8);

    JobRunner(JobStore store, List<JobHandler> handlerList, WorkerProperties props, MeterRegistry metrics) {
        this.store = store;
        this.props = props;
        this.metrics = metrics;
        for (JobHandler handler : handlerList) {
            for (JobType type : handler.types()) {
                handlers.put(type, handler);
            }
        }
    }

    @Scheduled(fixedDelayString = "${trustpass.jobs.poll-millis:1000}")
    public void poll() {
        int recovered = store.requeueStale(props.jobs().staleMinutes());
        if (recovered > 0) {
            log.warn("requeued {} stale jobs", recovered);
        }
        List<Job> batch;
        do {
            batch = store.claim(workerId, props.jobs().batchSize());
            batch.forEach(this::run);
        } while (batch.size() == props.jobs().batchSize());
    }

    void run(Job job) {
        if (job.traceId() != null) {
            MDC.put("traceId", job.traceId());
        }
        MDC.put("jobId", String.valueOf(job.id()));
        try {
            JobHandler handler = handlers.get(job.type());
            if (handler == null) {
                throw new IllegalStateException("no handler for " + job.type());
            }
            handler.handle(job);
            store.markDone(job.id());
            metrics.counter("trustpass.worker.jobs", "type", job.type().name(), "result", "done").increment();
            log.info("job {} {} done after {} attempt(s)", job.id(), job.type(), job.attempts());
        } catch (Exception e) {
            boolean dead = store.markFailed(job, e.getClass().getSimpleName() + ": " + e.getMessage());
            metrics.counter("trustpass.worker.jobs", "type", job.type().name(), "result", dead ? "dead" : "retry").increment();
            log.warn("job {} {} failed on attempt {}{}: {}", job.id(), job.type(), job.attempts(),
                    dead ? ", moved to dead letters" : "", e.getMessage());
        } finally {
            MDC.remove("traceId");
            MDC.remove("jobId");
        }
    }

    private static String hostname() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (UnknownHostException e) {
            return "worker";
        }
    }
}
