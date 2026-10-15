package com.trustpass.api.auth;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;

import com.trustpass.api.IntegrationTest;
import com.trustpass.api.shared.Role;
import io.restassured.response.Response;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AuthFlowTest extends IntegrationTest {

    private String uniqueEmail() {
        return "flow-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";
    }

    private Response signup(String email, String password) {
        return given().contentType("application/json")
                .body(Map.of("name", "Flow User", "email", email, "password", password)).post("/auth/signup");
    }

    private Response login(String email, String password) {
        return given().contentType("application/json").body(Map.of("email", email, "password", password)).post("/auth/login");
    }

    @Test
    void signupVerifyLoginAndReadProfile() {
        String email = uniqueEmail();
        signup(email, PASSWORD).then().statusCode(202);
        assertThat(jobCount("EMAIL_VERIFICATION", email)).isEqualTo(1);

        login(email, PASSWORD).then().statusCode(403).body("code", equalTo("EMAIL_NOT_VERIFIED"));

        given().queryParam("token", latestVerificationToken(email)).get("/auth/verify-email").then().statusCode(200);

        Response ok = login(email, PASSWORD);
        ok.then().statusCode(200).body("status", equalTo("OK")).body("user.email", equalTo(email));
        assertThat(ok.getDetailedCookie("tp_refresh").isHttpOnly()).isTrue();

        given().auth().oauth2(ok.path("accessToken")).get("/me").then().statusCode(200)
                .body("email", equalTo(email)).body("role", equalTo("MEMBER")).body("emailVerified", equalTo(true));
    }

    @Test
    void tokenIsStoredHashedAndUsableOnce() {
        String email = uniqueEmail();
        signup(email, PASSWORD);
        String token = latestVerificationToken(email);
        Integer plain = jdbc.queryForObject("select count(*) from email_verification_tokens where token_hash = ?", Integer.class, token);
        assertThat(plain).isZero();

        given().queryParam("token", token).get("/auth/verify-email").then().statusCode(200);
        given().queryParam("token", token).get("/auth/verify-email").then().statusCode(400).body("code", equalTo("TOKEN_USED"));
        given().queryParam("token", "garbage").get("/auth/verify-email").then().statusCode(400).body("code", equalTo("INVALID_TOKEN"));
    }

    @Test
    void expiredVerificationLinkIsRejected() {
        String email = uniqueEmail();
        signup(email, PASSWORD);
        String token = latestVerificationToken(email);
        jdbc.update("update email_verification_tokens set expires_at = now() - interval '1 minute' where user_id = (select id from users where email = ?)", email);
        given().queryParam("token", token).get("/auth/verify-email").then().statusCode(400).body("code", equalTo("TOKEN_EXPIRED"));
    }

    @Test
    void resendIssuesANewLinkOnlyForUnverifiedAccounts() {
        String email = uniqueEmail();
        signup(email, PASSWORD);
        given().contentType("application/json").body(Map.of("email", email)).post("/auth/resend-verification").then().statusCode(202);
        assertThat(jobCount("EMAIL_VERIFICATION", email)).isEqualTo(2);
        given().queryParam("token", latestVerificationToken(email)).get("/auth/verify-email").then().statusCode(200);
        given().contentType("application/json").body(Map.of("email", email)).post("/auth/resend-verification").then().statusCode(202);
        assertThat(jobCount("EMAIL_VERIFICATION", email)).isEqualTo(2);
    }

    @Test
    void weakPasswordsAndBadInputAreRejected() {
        signup(uniqueEmail(), "short1!").then().statusCode(400).body("code", equalTo("VALIDATION_FAILED"))
                .body("fieldErrors.password", notNullValue());
        signup("not-an-email", PASSWORD).then().statusCode(400).body("fieldErrors.email", notNullValue());
        signup(uniqueEmail(), "alllowercaseletters1").then().statusCode(400);
        given().contentType("application/json").body("{broken").post("/auth/signup").then().statusCode(400);
    }

    @Test
    void duplicateSignupDoesNotRevealOrCreateAnything() {
        String email = uniqueEmail();
        signup(email, PASSWORD).then().statusCode(202);
        signup(email, PASSWORD).then().statusCode(202);
        assertThat(jobCount("EMAIL_VERIFICATION", email)).isEqualTo(1);
    }

    @Test
    void passwordIsHashedWithArgon2() {
        Account account = newMember();
        String hash = jdbc.queryForObject("select password_hash from users where id = ?", String.class, account.id());
        assertThat(hash).startsWith("$argon2");
        assertThat(hash).doesNotContain(PASSWORD);
    }

    @Test
    void wrongPasswordAndUnknownEmailLookTheSame() {
        Account account = newMember();
        Response wrong = login(account.email(), "Wrong-pass-1!");
        Response unknown = login(uniqueEmail(), "Wrong-pass-1!");
        wrong.then().statusCode(401);
        unknown.then().statusCode(401);
        assertThat(wrong.path("message").toString()).isEqualTo(unknown.path("message").toString());
    }

    @Test
    void accountLocksAfterFiveFailuresAndStaffCanUnlock() {
        Account account = newMember();
        for (int i = 0; i < 5; i++) {
            login(account.email(), "Wrong-pass-1!").then().statusCode(401);
        }
        login(account.email(), PASSWORD).then().statusCode(423).body("code", equalTo("ACCOUNT_LOCKED"));

        Account support = newAccount(Role.SUPPORT);
        json(support).post("/admin/users/" + account.id() + "/unlock").then().statusCode(200).body("locked", equalTo(false));
        login(account.email(), PASSWORD).then().statusCode(200);
    }

    @Test
    void refreshTokensRotateAndReuseRevokesEverySession() {
        Account account = newMember();
        Response first = login(account.email(), PASSWORD);
        String accessToken = first.path("accessToken");
        String cookie1 = first.getCookie("tp_refresh");

        Response second = given().cookie("tp_refresh", cookie1).post("/auth/refresh");
        second.then().statusCode(200).body("accessToken", notNullValue());
        String cookie2 = second.getCookie("tp_refresh");
        assertThat(cookie2).isNotEqualTo(cookie1);

        given().cookie("tp_refresh", cookie1).post("/auth/refresh").then().statusCode(401);
        given().cookie("tp_refresh", cookie2).post("/auth/refresh").then().statusCode(401);
        given().auth().oauth2(accessToken).get("/me").then().statusCode(401);
        assertThat(jdbc.queryForObject(
                "select count(*) from audit_log where action = 'REFRESH_TOKEN_REUSE' and actor_id = ?", Long.class, account.id()))
                .isEqualTo(1);
    }

    @Test
    void refreshWithoutCookieIsUnauthorized() {
        given().post("/auth/refresh").then().statusCode(401);
        given().cookie("tp_refresh", "unknown").post("/auth/refresh").then().statusCode(401);
    }

    @Test
    void logoutRevokesTheSession() {
        Account account = newMember();
        Response session = login(account.email(), PASSWORD);
        String token = session.path("accessToken");
        given().auth().oauth2(token).get("/me").then().statusCode(200);
        given().cookie("tp_refresh", session.getCookie("tp_refresh")).post("/auth/logout").then().statusCode(204);
        given().auth().oauth2(token).get("/me").then().statusCode(401);
        given().post("/auth/logout").then().statusCode(204);
    }

    @Test
    void sessionsCanBeListedAndRevokedIndividuallyOrAll() {
        Account account = newMember();
        String other = login(account.email(), PASSWORD).path("accessToken");

        var sessions = as(account).get("/me/sessions").then().statusCode(200).extract().jsonPath().getList("$");
        assertThat(sessions).hasSize(2);
        var current = as(account).get("/me/sessions").jsonPath().getList("findAll { it.current }");
        assertThat(current).hasSize(1);
        String otherId = as(account).get("/me/sessions").jsonPath().getString("find { !it.current }.id");

        as(account).delete("/me/sessions/" + otherId).then().statusCode(204);
        given().auth().oauth2(other).get("/me").then().statusCode(401);
        as(account).delete("/me/sessions/" + otherId).then().statusCode(404);

        as(account).delete("/me/sessions").then().statusCode(204);
        as(account).get("/me").then().statusCode(401);
    }

    @Test
    void protectedEndpointsRejectMissingAndForgedTokens() {
        given().get("/me").then().statusCode(401).body("code", equalTo("UNAUTHORIZED"));
        given().auth().oauth2("not.a.token").get("/me").then().statusCode(401);
        Account member = newMember();
        as(member).get("/admin/users").then().statusCode(403).body("code", equalTo("FORBIDDEN"));
        as(member).get("/admin/audit-log").then().statusCode(403);
        as(member).get("/admin/jobs").then().statusCode(403);
        as(member).get("/admin/metrics/summary").then().statusCode(403);
        as(member).get("/admin/verifications").then().statusCode(403);
    }

    @Test
    void responsesCarryARequestIdAndErrorsEchoIt() {
        Response response = given().header("X-Request-Id", "abc-123").get("/me");
        response.then().statusCode(401).header("X-Request-Id", "abc-123").body("requestId", equalTo("abc-123"));
        given().header("X-Request-Id", "bad id with spaces").get("/me").then().header("X-Request-Id", org.hamcrest.Matchers.not(containsString(" ")));
    }

    @Test
    void failedAndSuccessfulLoginsAreRecordedAndAudited() {
        Account account = newMember();
        login(account.email(), "Wrong-pass-1!");
        assertThat(jdbc.queryForObject("select count(*) from login_events where email = ? and success = false", Long.class, account.email())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from audit_log where action = 'LOGIN' and actor_email = ?", Long.class, account.email())).isGreaterThanOrEqualTo(1);
    }
}
