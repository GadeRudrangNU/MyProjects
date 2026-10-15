package com.trustpass.api.shared;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class OpenApiConfig {

    @Bean
    OpenAPI openApi() {
        return new OpenAPI()
                .info(new Info().title("TrustPass API").version("1.0.0"))
                .components(new Components().addSecuritySchemes("bearer",
                        new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList("bearer"));
    }

    private static final Map<String, Set<String>> OPTIONAL = Map.ofEntries(
            Map.entry("LoginResponse", Set.of("accessToken", "expiresIn", "mfaToken", "user")),
            Map.entry("PaymentResult", Set.of("subscription", "failureReason")),
            Map.entry("MemberView", Set.of("rejectReason")),
            Map.entry("ReviewItem", Set.of("rejectReason")),
            Map.entry("SubscriptionView", Set.of("cancelledAt")),
            Map.entry("PaymentView", Set.of("failureReason")),
            Map.entry("JobView", Set.of("lastError", "traceId")),
            Map.entry("AuditEntry", Set.of("actorId", "actorEmail", "targetType", "targetId", "ip")),
            Map.entry("SlotView", Set.of("myBookingId")),
            Map.entry("Decision", Set.of("reason")));

    @Bean
    OpenApiCustomizer requiredPropertiesCustomizer() {
        return openApi -> openApi.getComponents().getSchemas().forEach((name, schema) -> {
            if (schema.getProperties() == null) {
                return;
            }
            Set<String> optional = OPTIONAL.getOrDefault(name, Set.of());
            List<String> required = ((Map<String, ?>) schema.getProperties()).keySet().stream()
                    .filter(property -> !optional.contains(property)).toList();
            schema.setRequired(required);
        });
    }
}
