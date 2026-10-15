package com.trustpass.api;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PlatformTest extends IntegrationTest {

    @Test
    void prometheusExposesRequestAndBusinessMetrics() {
        Account member = newMember();
        given().contentType("application/json").body(Map.of("email", member.email(), "password", "Wrong-pass-1!")).post("/auth/login");
        String metrics = given().get("/actuator/prometheus").then().statusCode(200).extract().asString();
        assertThat(metrics).contains("http_server_requests_seconds_bucket")
                .contains("trustpass_login_total")
                .contains("trustpass_jobs_backlog")
                .contains("trustpass_jobs_dead")
                .contains("jvm_memory_used_bytes");
    }

    @Test
    void healthIsPublicAndOtherActuatorEndpointsAreNot() {
        given().get("/actuator/health").then().statusCode(200).body("status", equalTo("UP"));
        given().get("/actuator/env").then().statusCode(401);
    }

    @Test
    void jobsRecordTheTraceIdOfTheRequestThatCreatedThem() {
        Account member = newMember();
        String email = "trace-" + java.util.UUID.randomUUID().toString().substring(0, 8) + "@example.test";
        given().contentType("application/json").body(Map.of("name", "Trace", "email", email, "password", PASSWORD))
                .post("/auth/signup").then().statusCode(202);
        String trace = jdbc.queryForObject("select trace_id from outbox_jobs where type = 'EMAIL_VERIFICATION' and payload->>'email' = ?", String.class, email);
        assertThat(trace).isNotBlank().hasSize(32);
        assertThat(member).isNotNull();
    }

    @Test
    void openApiDocumentDescribesTheApiAndCanBeExported() throws Exception {
        String body = given().get("/v3/api-docs").then().statusCode(200)
                .body("info.title", equalTo("TrustPass API")).body("components.securitySchemes.bearer.scheme", equalTo("bearer"))
                .body("paths.'/auth/login'.post", notNullValue()).body("paths.'/subscriptions'.post", notNullValue())
                .body("paths.'/verifications'.post.requestBody.content.'multipart/form-data'", notNullValue())
                .extract().asString();
        given().get("/swagger-ui/index.html").then().statusCode(200).body(containsString("swagger"));
        String out = System.getProperty("openapi.out");
        if (out != null) {
            Files.writeString(Path.of(out), body);
        }
    }

    @Test
    void unknownRoutesAndMethodsReturnJsonErrors() {
        Account member = newMember();
        as(member).get("/nothing-here").then().statusCode(404);
        as(member).put("/me").then().statusCode(405).body("code", equalTo("METHOD_NOT_ALLOWED"));
        as(member).contentType("text/plain").body("x").post("/bookings").then().statusCode(415);
    }
}
