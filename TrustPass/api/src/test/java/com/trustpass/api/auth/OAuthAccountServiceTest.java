package com.trustpass.api.auth;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;

import com.trustpass.api.IntegrationTest;
import com.trustpass.api.auth.OAuthAccountService.Profile;
import com.trustpass.api.auth.OAuthAccountService.Resolution;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class OAuthAccountServiceTest extends IntegrationTest {

    @Autowired
    private OAuthAccountService oauth;

    private String subject() {
        return UUID.randomUUID().toString();
    }

    @Test
    void firstSignInCreatesAVerifiedAccountAndLaterSignInsFindIt() {
        String email = "oauth-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";
        String subject = subject();
        Resolution created = oauth.resolve(new Profile("github", subject, email, true, "Octo Cat"));
        assertThat(created.user()).isNotNull();
        assertThat(created.user().isEmailVerified()).isTrue();
        assertThat(created.user().getPasswordHash()).isNull();

        Resolution again = oauth.resolve(new Profile("github", subject, email, true, "Octo Cat"));
        assertThat(again.user().getId()).isEqualTo(created.user().getId());
        assertThat(oauth.outcomeFor(again.user()).authenticated()).isNotNull();
    }

    @Test
    void matchingEmailRequiresAnExplicitLinkConfirmationWithThePassword() {
        Account existing = newMember();
        String subject = subject();
        Resolution pending = oauth.resolve(new Profile("google", subject, existing.email(), true, "Same Person"));
        assertThat(pending.user()).isNull();
        assertThat(pending.linkToken()).isNotBlank();
        assertThat(jdbc.queryForObject("select count(*) from oauth_identities where subject = ?", Long.class, subject)).isZero();

        given().contentType("application/json").body(Map.of("linkToken", pending.linkToken(), "password", "Wrong-pass-1!"))
                .post("/auth/oauth/link").then().statusCode(401);
        given().contentType("application/json").body(Map.of("linkToken", "junk", "password", PASSWORD))
                .post("/auth/oauth/link").then().statusCode(401);
        given().contentType("application/json").body(Map.of("linkToken", pending.linkToken(), "password", PASSWORD))
                .post("/auth/oauth/link").then().statusCode(200).body("status", equalTo("OK")).body("user.email", equalTo(existing.email()));
        assertThat(jdbc.queryForObject("select count(*) from oauth_identities where subject = ?", Long.class, subject)).isEqualTo(1);
        assertThat(oauth.resolve(new Profile("google", subject, existing.email(), true, "x")).user().getId()).isEqualTo(existing.id());
    }

    @Test
    void anAccessTokenCannotBeUsedAsALinkToken() {
        Account existing = newMember();
        given().contentType("application/json").body(Map.of("linkToken", existing.token(), "password", PASSWORD))
                .post("/auth/oauth/link").then().statusCode(401);
    }

    @Test
    void unverifiedProviderEmailsAreRefused() {
        Resolution refused = oauth.resolve(new Profile("github", subject(), "fake@example.test", false, "Mallory"));
        assertThat(refused.error()).isEqualTo("unverified_email");
        assertThat(oauth.resolve(new Profile("github", subject(), null, true, "No Email")).error()).isEqualTo("unverified_email");
    }

    @Test
    void linkedAccountsWithTwoFactorGetAChallengeInsteadOfASession() {
        Account account = newMember();
        jdbc.update("update users set mfa_enabled = true, mfa_secret = ? where id = ?", crypto.encrypt("JBSWY3DPEHPK3PXP"), account.id());
        var outcome = oauth.outcomeFor(users.get(account.id()));
        assertThat(outcome.authenticated()).isNull();
        assertThat(outcome.mfaToken()).isNotBlank();
    }

    @Test
    void providersEndpointListsNothingWhenNoCredentialsAreConfigured() {
        given().get("/auth/providers").then().statusCode(200).body("$", hasSize(0));
    }
}
