package com.trustpass.api.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trustpass.api.shared.CurrentUser;
import com.trustpass.api.shared.RequestContext;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class AuditService {

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;

    AuditService(JdbcClient jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public void record(String action, String targetType, String targetId, Map<String, Object> details) {
        var actor = CurrentUser.find();
        insert(actor.map(CurrentUser::id).orElse(null), actor.map(CurrentUser::email).orElse(null),
                action, targetType, targetId, details);
    }

    public void recordAs(UUID actorId, String actorEmail, String action, String targetType, String targetId,
                         Map<String, Object> details) {
        insert(actorId, actorEmail, action, targetType, targetId, details);
    }

    private void insert(UUID actorId, String actorEmail, String action, String targetType, String targetId,
                        Map<String, Object> details) {
        jdbc.sql("""
                        insert into audit_log (actor_id, actor_email, action, target_type, target_id, ip, details)
                        values (cast(:actorId as uuid), :actorEmail, :action, :targetType, :targetId, :ip, cast(:details as jsonb))
                        """)
                .param("actorId", actorId == null ? null : actorId.toString())
                .param("actorEmail", actorEmail)
                .param("action", action)
                .param("targetType", targetType)
                .param("targetId", targetId)
                .param("ip", RequestContext.ip())
                .param("details", toJson(details))
                .update();
    }

    private String toJson(Map<String, Object> details) {
        try {
            return mapper.writeValueAsString(details == null ? Map.of() : details);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }
}
