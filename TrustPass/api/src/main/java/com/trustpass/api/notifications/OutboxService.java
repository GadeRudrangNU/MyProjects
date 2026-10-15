package com.trustpass.api.notifications;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trustpass.common.FieldCrypto;
import com.trustpass.common.JobType;
import java.util.Map;
import org.slf4j.MDC;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OutboxService {

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;
    private final FieldCrypto crypto;

    OutboxService(JdbcClient jdbc, ObjectMapper mapper, FieldCrypto crypto) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.crypto = crypto;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void enqueue(JobType type, Map<String, Object> payload) {
        try {
            jdbc.sql("insert into outbox_jobs (type, payload, trace_id) values (:type, cast(:payload as jsonb), :trace)")
                    .param("type", type.name())
                    .param("payload", mapper.writeValueAsString(payload))
                    .param("trace", MDC.get("traceId"))
                    .update();
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("payload is not serialisable", e);
        }
    }

    public String seal(String secret) {
        return crypto.encrypt(secret);
    }
}
