package com.trustpass.api.authserver;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trustpass.api.IntegrationTest;
import java.net.CookieManager;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class AuthorizationServerTest extends IntegrationTest {

    private static final String REDIRECT = "http://localhost:5174/callback";
    private static final ObjectMapper JSON = new ObjectMapper();

    private HttpClient client() {
        return HttpClient.newBuilder().cookieHandler(new CookieManager()).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    private String base() {
        return "http://localhost:" + port;
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String form(Map<String, String> fields) {
        return fields.entrySet().stream().map(e -> enc(e.getKey()) + "=" + enc(e.getValue())).collect(Collectors.joining("&"));
    }

    private HttpResponse<String> get(HttpClient client, String url) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create(url)).header("Accept", "text/html,application/xhtml+xml").GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(HttpClient client, String url, String body) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create(url)).header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "text/html,application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }

    private static String csrf(String html) {
        Matcher m = Pattern.compile("name=\"_csrf\" value=\"([^\"]+)\"").matcher(html);
        assertThat(m.find()).as("csrf field present").isTrue();
        return m.group(1);
    }

    private static String location(HttpResponse<?> response) {
        return response.headers().firstValue("Location").orElseThrow();
    }

    private static String challenge(String verifier) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }

    private String authorizeUrl(String challenge, String scope) {
        return base() + "/oauth2/authorize?" + form(new LinkedHashMap<>(Map.of(
                "response_type", "code", "client_id", "partner-demo", "redirect_uri", REDIRECT, "scope", scope,
                "state", "state-xyz", "code_challenge", challenge, "code_challenge_method", "S256")));
    }

    private String runFlowUntilCode(HttpClient client, String email, String password, String verifier, String scope) throws Exception {
        HttpResponse<String> start = get(client, authorizeUrl(challenge(verifier), scope));
        assertThat(start.statusCode()).isEqualTo(302);
        assertThat(location(start)).contains("/sso/login");

        HttpResponse<String> loginPage = get(client, location(start));
        assertThat(loginPage.statusCode()).isEqualTo(200);
        HttpResponse<String> loggedIn = post(client, base() + "/sso/login",
                form(Map.of("username", email, "password", password, "_csrf", csrf(loginPage.body()))));
        assertThat(loggedIn.statusCode()).isEqualTo(302);

        HttpResponse<String> resumed = get(client, location(loggedIn));
        assertThat(resumed.statusCode()).isEqualTo(302);
        if (location(resumed).startsWith(REDIRECT)) {
            return codeFrom(location(resumed));
        }
        assertThat(location(resumed)).contains("/oauth2/consent");

        Matcher stateMatcher = Pattern.compile("[?&]state=([^&]+)").matcher(location(resumed));
        assertThat(stateMatcher.find()).isTrue();
        String consentState = URLDecoder.decode(stateMatcher.group(1), StandardCharsets.UTF_8);
        HttpResponse<String> consent = get(client, location(resumed));
        assertThat(consent.statusCode()).isEqualTo(200);
        assertThat(consent.body()).contains("verified person over 21").contains("never shared");

        StringBuilder body = new StringBuilder(form(Map.of("client_id", "partner-demo", "state", consentState, "_csrf", csrf(consent.body()))));
        for (String s : scope.split(" ")) {
            body.append("&scope=").append(enc(s));
        }
        HttpResponse<String> approved = post(client, base() + "/oauth2/authorize", body.toString());
        assertThat(approved.statusCode()).as(approved.body()).isEqualTo(302);
        return codeFrom(location(approved));
    }

    private static String codeFrom(String callback) {
        assertThat(callback).startsWith(REDIRECT).contains("state=state-xyz");
        Matcher m = Pattern.compile("[?&]code=([^&]+)").matcher(callback);
        assertThat(m.find()).as(callback).isTrue();
        return URLDecoder.decode(m.group(1), StandardCharsets.UTF_8);
    }

    private HttpResponse<String> exchange(HttpClient client, String code, String verifier) throws Exception {
        return post(client, base() + "/oauth2/token", form(Map.of("grant_type", "authorization_code", "code", code,
                "redirect_uri", REDIRECT, "client_id", "partner-demo", "code_verifier", verifier)));
    }

    private JsonNode userInfo(HttpClient client, String accessToken) throws Exception {
        HttpResponse<String> response = client.send(HttpRequest.newBuilder(URI.create(base() + "/userinfo"))
                .header("Authorization", "Bearer " + accessToken).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return JSON.readTree(response.body());
    }

    @Test
    void partnerReceivesAYesNoAgeClaimAndNeverTheBirthDate() throws Exception {
        Account member = newMember();
        jdbc.update("update users set identity_verified = true, age_over_21 = true where id = ?", member.id());
        String scope = "openid profile email verified_age_over_21";
        String verifier = "v".repeat(50);
        HttpClient client = client();

        String code = runFlowUntilCode(client, member.email(), PASSWORD, verifier, scope);
        HttpResponse<String> token = exchange(client, code, verifier);
        assertThat(token.statusCode()).isEqualTo(200);
        JsonNode tokens = JSON.readTree(token.body());
        assertThat(tokens.has("id_token")).isTrue();

        JsonNode info = userInfo(client, tokens.get("access_token").asText());
        assertThat(info.get("sub").asText()).isEqualTo(member.id().toString());
        assertThat(info.get("email").asText()).isEqualTo(member.email());
        assertThat(info.get("verified_age_over_21").asBoolean()).isTrue();
        assertThat(info.has("birthdate")).isFalse();
        assertThat(info.has("dob")).isFalse();

        String idPayload = new String(Base64.getUrlDecoder().decode(tokens.get("id_token").asText().split("\\.")[1]), StandardCharsets.UTF_8);
        assertThat(JSON.readTree(idPayload).get("verified_age_over_21").asBoolean()).isTrue();
    }

    @Test
    void unverifiedMembersGetANoAndScopesLimitTheClaims() throws Exception {
        Account member = newMember();
        String verifier = "w".repeat(50);
        HttpClient client = client();
        String code = runFlowUntilCode(client, member.email(), PASSWORD, verifier, "openid verified_age_over_21");
        JsonNode tokens = JSON.readTree(exchange(client, code, verifier).body());
        JsonNode info = userInfo(client, tokens.get("access_token").asText());
        assertThat(info.get("verified_age_over_21").asBoolean()).isFalse();
        assertThat(info.has("email")).isFalse();
        assertThat(info.has("name")).isFalse();
    }

    @Test
    void codeIsBoundToThePkceVerifierAndCannotBeReused() throws Exception {
        Account member = newMember();
        String verifier = "x".repeat(50);
        HttpClient client = client();
        String code = runFlowUntilCode(client, member.email(), PASSWORD, verifier, "openid");

        HttpResponse<String> wrong = exchange(client, code, "y".repeat(50));
        assertThat(wrong.statusCode()).isEqualTo(400);
        assertThat(wrong.body()).contains("invalid_grant");

        String second = runFlowUntilCode(client(), member.email(), PASSWORD, verifier, "openid");
        assertThat(exchange(client, second, verifier).statusCode()).isEqualTo(200);
        assertThat(exchange(client, second, verifier).statusCode()).isEqualTo(400);
    }

    @Test
    void publicClientsMustUsePkce() throws Exception {
        HttpResponse<String> response = get(client(), base() + "/oauth2/authorize?" + form(Map.of("response_type", "code",
                "client_id", "partner-demo", "redirect_uri", REDIRECT, "scope", "openid", "state", "s")));
        assertThat(response.statusCode()).isEqualTo(302);
        assertThat(location(response)).doesNotContain("/sso/login");
    }

    @Test
    void wrongPasswordKeepsTheUserOnTheLoginPage() throws Exception {
        Account member = newMember();
        HttpClient client = client();
        HttpResponse<String> start = get(client, authorizeUrl(challenge("z".repeat(50)), "openid"));
        HttpResponse<String> loginPage = get(client, location(start));
        HttpResponse<String> failed = post(client, base() + "/sso/login",
                form(Map.of("username", member.email(), "password", "Wrong-pass-1!", "_csrf", csrf(loginPage.body()))));
        assertThat(failed.statusCode()).isEqualTo(302);
        assertThat(location(failed)).contains("/sso/login?error");
        HttpResponse<String> again = get(client, location(failed));
        assertThat(again.body()).contains("were not accepted");
    }

    @Test
    void usersWithTwoFactorMustProvideTheCodeOnTheSsoLoginForm() throws Exception {
        Account member = newMember();
        String secret = "JBSWY3DPEHPK3PXP";
        jdbc.update("update users set mfa_enabled = true, mfa_secret = ? where id = ?", crypto.encrypt(secret), member.id());
        HttpClient client = client();
        HttpResponse<String> start = get(client, authorizeUrl(challenge("q".repeat(50)), "openid"));
        HttpResponse<String> loginPage = get(client, location(start));
        HttpResponse<String> noCode = post(client, base() + "/sso/login",
                form(Map.of("username", member.email(), "password", PASSWORD, "_csrf", csrf(loginPage.body()))));
        assertThat(location(noCode)).contains("/sso/login?error");

        long step = Math.floorDiv(new dev.samstevens.totp.time.SystemTimeProvider().getTime(), 30);
        String code = new dev.samstevens.totp.code.DefaultCodeGenerator().generate(secret, step);
        HttpResponse<String> page = get(client, base() + "/sso/login");
        HttpResponse<String> ok = post(client, base() + "/sso/login",
                form(Map.of("username", member.email(), "password", PASSWORD, "code", code, "_csrf", csrf(page.body()))));
        assertThat(location(ok)).doesNotContain("error");
    }

    @Test
    void discoveryDocumentAndKeysArePublishedAndTokensAreCorsEnabledForThePartner() {
        given().get("/.well-known/openid-configuration").then().statusCode(200)
                .body("authorization_endpoint", containsString("/oauth2/authorize"))
                .body("userinfo_endpoint", containsString("/userinfo"))
                .body("code_challenge_methods_supported[0]", equalTo("S256"));
        given().get("/oauth2/jwks").then().statusCode(200).body("keys[0].kty", equalTo("RSA"));
        given().header("Origin", "http://localhost:5174").header("Access-Control-Request-Method", "POST")
                .options("/oauth2/token").then().statusCode(200).header("Access-Control-Allow-Origin", "http://localhost:5174");
        given().get("/userinfo").then().statusCode(401);
    }
}
