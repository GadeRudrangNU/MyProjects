package com.trustpass.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.trustpass.api.IntegrationTest;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.TrustPassProperties;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;

class SecurityPrimitivesTest extends IntegrationTest {

    @Autowired
    private DataSource dataSource;
    @Autowired
    private PasswordHasher passwords;

    private final StrongPasswordValidator validator = new StrongPasswordValidator();

    @ParameterizedTest
    @ValueSource(strings = {"Abcdef123!x", "Correct-Horse-9", "Ünïcode-Pass-77"})
    void acceptsStrongPasswords(String value) {
        assertThat(validator.isValid(value, null)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"Sh0rt!", "alllowercase123!", "ALLUPPERCASE123!", "NoDigitsHere!!", "NoSymbols12345", "          "})
    void rejectsWeakPasswords(String value) {
        assertThat(validator.isValid(value, null)).isFalse();
    }

    @Test
    void nullAndOverlongPasswords() {
        assertThat(validator.isValid(null, null)).isTrue();
        assertThat(validator.isValid("Aa1!" + "x".repeat(130), null)).isFalse();
    }

    @Test
    void hashesAreSaltedAndVerifiable() {
        String first = passwords.hash("Correct-Horse-9");
        String second = passwords.hash("Correct-Horse-9");
        assertThat(first).isNotEqualTo(second);
        assertThat(passwords.matches("Correct-Horse-9", first)).isTrue();
        assertThat(passwords.matches("correct-horse-9", first)).isFalse();
        assertThat(passwords.matches("anything", null)).isFalse();
        passwords.spendTime("anything");
    }

    @Test
    void bucketsAreSharedThroughPostgresAndEnforceTheLimit() {
        TrustPassProperties enabled = com.trustpass.api.billing.ResilientPaymentGatewayTest.props(100, 0, 0);
        RateLimiter limiter = new RateLimiter(dataSource, enabled);
        String key = "test:" + UUID.randomUUID();
        for (int i = 0; i < 3; i++) {
            limiter.check(key, 3, Duration.ofMinutes(1));
        }
        assertThatThrownBy(() -> limiter.check(key, 3, Duration.ofMinutes(1)))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.status().value()).isEqualTo(429);
                    assertThat(e.code()).isEqualTo("RATE_LIMITED");
                });
        RateLimiter another = new RateLimiter(dataSource, enabled);
        assertThatThrownBy(() -> another.check(key, 3, Duration.ofMinutes(1))).isInstanceOf(ApiException.class);
        limiter.check("different-" + key, 3, Duration.ofMinutes(1));
        assertThat(jdbc.queryForObject("select count(*) from rate_limit_buckets", Long.class)).isGreaterThanOrEqualTo(2);
    }

    @Test
    void loginIsThrottledPerAccountWhenTheLimiterIsOn() {
        TrustPassProperties strict = new TrustPassProperties(
                new TrustPassProperties.Db(true, 0, ".data"),
                new TrustPassProperties.Security("0123456789012345678901234567890123456789", "key", Duration.ofMinutes(15),
                        Duration.ofDays(7), false, 5, Duration.ofMinutes(15), "http://localhost:8080"),
                new TrustPassProperties.RateLimit(true, 100, 2, 100),
                new TrustPassProperties.Payment(0, 0, 1, 5, 100),
                new TrustPassProperties.Storage("uploads", 1024), new TrustPassProperties.Cors(List.of()),
                new TrustPassProperties.Seed(false, false), "http://localhost:5173");
        RateLimiter limiter = new RateLimiter(dataSource, strict);
        String email = "limited-" + UUID.randomUUID();
        limiter.check("login:email:" + email, strict.rateLimit().loginPerEmailPerMinute(), Duration.ofMinutes(1));
        limiter.check("login:email:" + email, strict.rateLimit().loginPerEmailPerMinute(), Duration.ofMinutes(1));
        assertThatThrownBy(() -> limiter.check("login:email:" + email, strict.rateLimit().loginPerEmailPerMinute(), Duration.ofMinutes(1)))
                .isInstanceOf(ApiException.class).hasMessageContaining("Too many attempts");
    }
}
