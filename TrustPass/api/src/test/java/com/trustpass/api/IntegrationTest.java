package com.trustpass.api;

import com.trustpass.api.auth.PasswordHasher;
import com.trustpass.api.billing.TestPaymentConfig;
import com.trustpass.api.shared.Role;
import com.trustpass.api.users.User;
import com.trustpass.api.users.UserService;
import com.trustpass.common.FieldCrypto;
import io.restassured.RestAssured;
import io.restassured.specification.RequestSpecification;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@AutoConfigureObservability
@Import(TestPaymentConfig.class)
public abstract class IntegrationTest {

    protected static final String PASSWORD = "Sup3r$ecret-pass";

    @LocalServerPort
    protected int port;
    @Autowired
    protected JdbcTemplate jdbc;
    @Autowired
    protected FieldCrypto crypto;
    @Autowired
    protected PasswordHasher hasher;
    @Autowired
    protected UserService users;

    @BeforeEach
    void configureRestAssured() {
        RestAssured.baseURI = "http://localhost";
        RestAssured.port = port;
    }

    public record Account(UUID id, String email, String token) {
    }

    protected Account newAccount(Role role) {
        String email = "user-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";
        User user = users.create("Test " + role.name().toLowerCase(), email, hasher.hash(PASSWORD), true);
        if (role != Role.MEMBER) {
            jdbc.update("update users set role = ? where id = ?", role.name(), user.getId());
        }
        return new Account(user.getId(), email, loginToken(email));
    }

    protected Account newMember() {
        return newAccount(Role.MEMBER);
    }

    protected Account newMemberWithMembership() {
        Account account = newMember();
        grantMembership(account.id());
        return account;
    }

    protected String loginToken(String email) {
        return RestAssured.given().contentType("application/json")
                .body(Map.of("email", email, "password", PASSWORD))
                .post("/auth/login").then().statusCode(200).extract().path("accessToken");
    }

    protected void grantMembership(UUID userId) {
        jdbc.update("""
                insert into subscriptions (id, user_id, plan_id, status, current_period_end)
                values (?, ?, '11111111-1111-1111-1111-111111111111', 'ACTIVE', ?)
                """, UUID.randomUUID(), userId, java.sql.Timestamp.from(Instant.now().plus(30, ChronoUnit.DAYS)));
    }

    protected RequestSpecification as(Account account) {
        return RestAssured.given().auth().oauth2(account.token());
    }

    protected RequestSpecification json(Account account) {
        return as(account).contentType("application/json");
    }

    protected String latestVerificationToken(String email) {
        String sealed = jdbc.queryForObject("""
                select payload->>'token' from outbox_jobs
                where type = 'EMAIL_VERIFICATION' and payload->>'email' = ? order by id desc limit 1
                """, String.class, email);
        return crypto.decrypt(sealed);
    }

    protected long jobCount(String type, String email) {
        Long count = jdbc.queryForObject(
                "select count(*) from outbox_jobs where type = ? and payload->>'email' = ?", Long.class, type, email);
        return count == null ? 0 : count;
    }
}
