package com.trustpass.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.trustpass.common.JobType;

public record Job(long id, JobType type, JsonNode payload, int attempts, String traceId) {

    public String text(String field) {
        JsonNode node = payload.get(field);
        return node == null || node.isNull() ? null : node.asText();
    }
}
