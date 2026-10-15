package com.trustpass.api.auth;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.startsWith;

import com.trustpass.api.IntegrationTest;
import dev.samstevens.totp.code.DefaultCodeGenerator;
import dev.samstevens.totp.time.SystemTimeProvider;
import io.restassured.response.Response;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class MfaTest extends IntegrationTest {

    private String code(String secret) throws Exception {
        long step = Math.floorDiv(new SystemTimeProvider().getTime(), 30);
        return new DefaultCodeGenerator().generate(secret, step);
    }

    private Response login(Account account) {
        return given().contentType("application/json").body(Map.of("email", account.email(), "password", PASSWORD)).post("/auth/login");
    }

    private List<String> enableMfa(Account account) throws Exception {
        String secret = json(account).post("/me/mfa/setup").then().statusCode(200)
                .body("qrCode", startsWith("data:image/png;base64,")).body("otpauthUri", startsWith("otpauth://totp/"))
                .extract().path("secret");
        return json(account).body(Map.of("code", code(secret))).post("/me/mfa/enable").then().statusCode(200)
                .body("codes", hasSize(8)).extract().path("codes");
    }

    private String secretOf(Account account) {
        return crypto.decrypt(jdbc.queryForObject("select mfa_secret from users where id = ?", String.class, account.id()));
    }

    @Test
    void totpGuardsLoginOnceEnabled() throws Exception {
        Account account = newMember();
        enableMfa(account);

        Response challenge = login(account);
        challenge.then().statusCode(200).body("status", equalTo("MFA_REQUIRED")).body("accessToken", equalTo(null));
        String mfaToken = challenge.path("mfaToken");
        assertThat(challenge.getCookie("tp_refresh")).isNull();

        given().contentType("application/json").body(Map.of("mfaToken", mfaToken, "code", "000000")).post("/auth/mfa/verify")
                .then().statusCode(401);
        Response done = given().contentType("application/json").body(Map.of("mfaToken", mfaToken, "code", code(secretOf(account))))
                .post("/auth/mfa/verify");
        done.then().statusCode(200).body("status", equalTo("OK")).body("accessToken", notNullValue());
        assertThat(done.getCookie("tp_refresh")).isNotBlank();
    }

    @Test
    void secretIsEncryptedAtRest() throws Exception {
        Account account = newMember();
        enableMfa(account);
        String stored = jdbc.queryForObject("select mfa_secret from users where id = ?", String.class, account.id());
        assertThat(stored).isNotEqualTo(secretOf(account));
    }

    @Test
    void backupCodesWorkExactlyOnce() throws Exception {
        Account account = newMember();
        List<String> backups = enableMfa(account);
        String mfaToken = login(account).path("mfaToken");

        given().contentType("application/json").body(Map.of("mfaToken", mfaToken, "code", backups.get(0))).post("/auth/mfa/verify")
                .then().statusCode(200);
        given().contentType("application/json").body(Map.of("mfaToken", mfaToken, "code", backups.get(0))).post("/auth/mfa/verify")
                .then().statusCode(401);
        given().contentType("application/json").body(Map.of("mfaToken", mfaToken, "code", backups.get(1).toUpperCase())).post("/auth/mfa/verify")
                .then().statusCode(200);
    }

    @Test
    void mfaTokenCannotBeUsedAsAnAccessTokenAndGarbageIsRejected() throws Exception {
        Account account = newMember();
        enableMfa(account);
        String mfaToken = login(account).path("mfaToken");
        given().auth().oauth2(mfaToken).get("/me").then().statusCode(401);
        given().contentType("application/json").body(Map.of("mfaToken", "junk", "code", "123456")).post("/auth/mfa/verify").then().statusCode(401);
        given().contentType("application/json").body(Map.of("mfaToken", account.token(), "code", "123456")).post("/auth/mfa/verify").then().statusCode(401);
    }

    @Test
    void repeatedWrongCodesLockTheAccount() throws Exception {
        Account account = newMember();
        enableMfa(account);
        String mfaToken = login(account).path("mfaToken");
        for (int i = 0; i < 5; i++) {
            given().contentType("application/json").body(Map.of("mfaToken", mfaToken, "code", "111111")).post("/auth/mfa/verify").then().statusCode(401);
        }
        given().contentType("application/json").body(Map.of("mfaToken", mfaToken, "code", code(secretOf(account)))).post("/auth/mfa/verify")
                .then().statusCode(423);
    }

    @Test
    void setupRulesAndDisabling() throws Exception {
        Account account = newMember();
        json(account).body(Map.of("code", "123456")).post("/me/mfa/enable").then().statusCode(400).body("code", equalTo("INVALID_CODE"));
        String secret = json(account).post("/me/mfa/setup").path("secret");
        json(account).body(Map.of("code", "000000")).post("/me/mfa/enable").then().statusCode(400);
        json(account).body(Map.of("code", code(secret))).post("/me/mfa/enable").then().statusCode(200);
        json(account).post("/me/mfa/setup").then().statusCode(409).body("code", equalTo("MFA_ALREADY_ENABLED"));
        json(account).body(Map.of("code", code(secret))).post("/me/mfa/enable").then().statusCode(409);

        json(account).body(Map.of("password", "wrong-password", "code", code(secret))).post("/me/mfa/disable").then().statusCode(400);
        json(account).body(Map.of("password", PASSWORD, "code", code(secret))).post("/me/mfa/disable").then().statusCode(204);
        json(account).body(Map.of("password", PASSWORD, "code", code(secret))).post("/me/mfa/disable").then().statusCode(409);
        login(account).then().body("status", equalTo("OK"));
    }
}
