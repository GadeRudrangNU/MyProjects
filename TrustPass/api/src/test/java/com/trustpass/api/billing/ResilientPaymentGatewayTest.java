package com.trustpass.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.trustpass.api.billing.PaymentProvider.ChargeResult;
import com.trustpass.api.billing.PaymentProvider.ProviderUnavailableException;
import com.trustpass.api.shared.TrustPassProperties;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

public class ResilientPaymentGatewayTest {

    public static TrustPassProperties props(int timeoutMs, double decline, double outage) {
        return new TrustPassProperties(
                new TrustPassProperties.Db(true, 0, ".data"),
                new TrustPassProperties.Security("0123456789012345678901234567890123456789", "key", Duration.ofMinutes(15),
                        Duration.ofDays(7), false, 5, Duration.ofMinutes(15), "http://localhost:8080"),
                new TrustPassProperties.RateLimit(true, 30, 10, 20),
                new TrustPassProperties.Payment(decline, outage, 1, 5, timeoutMs),
                new TrustPassProperties.Storage("uploads", 1024),
                new TrustPassProperties.Cors(List.of()),
                new TrustPassProperties.Seed(false, false),
                "http://localhost:5173");
    }

    @Test
    void circuitOpensAfterRepeatedFailuresAndStopsCallingTheProvider() {
        AtomicInteger calls = new AtomicInteger();
        PaymentProvider failing = (ref, cents) -> {
            calls.incrementAndGet();
            throw new ProviderUnavailableException("down");
        };
        ResilientPaymentGateway gateway = new ResilientPaymentGateway(failing, props(500, 0, 0), new SimpleMeterRegistry());

        for (int i = 0; i < 2; i++) {
            assertThatThrownBy(() -> gateway.charge("ref", 100)).isInstanceOf(ProviderUnavailableException.class);
        }
        int before = calls.get();
        assertThatThrownBy(() -> gateway.charge("ref", 100))
                .isInstanceOf(ProviderUnavailableException.class).hasMessageContaining("circuit is open");
        assertThat(calls.get()).isEqualTo(before);
    }

    @Test
    void slowProviderTimesOut() {
        PaymentProvider slow = (ref, cents) -> {
            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return new ChargeResult(true, "late", null);
        };
        ResilientPaymentGateway gateway = new ResilientPaymentGateway(slow, props(100, 0, 0), new SimpleMeterRegistry());
        assertThatThrownBy(() -> gateway.charge("ref", 100)).isInstanceOf(ProviderUnavailableException.class)
                .hasMessageContaining("timed out");
    }

    @Test
    void unexpectedProviderErrorsAreTreatedAsUnavailable() {
        PaymentProvider broken = (ref, cents) -> {
            throw new IllegalStateException("boom");
        };
        ResilientPaymentGateway gateway = new ResilientPaymentGateway(broken, props(200, 0, 0), new SimpleMeterRegistry());
        assertThatThrownBy(() -> gateway.charge("ref", 100)).isInstanceOf(ProviderUnavailableException.class);
    }

    @Test
    void mockProviderIsIdempotentPerReference() {
        MockPaymentProvider provider = new MockPaymentProvider(props(200, 0.5, 0));
        ChargeResult first = null;
        for (int i = 0; i < 20 && first == null; i++) {
            first = provider.charge("ref-" + i, 100);
        }
        ChargeResult again = provider.charge("ref-0", 100);
        assertThat(again).isEqualTo(provider.charge("ref-0", 100));
    }

    @Test
    void mockProviderDeclinesAndFailsAtTheConfiguredRates() {
        MockPaymentProvider alwaysDecline = new MockPaymentProvider(props(200, 1.0, 0));
        assertThat(alwaysDecline.charge("a", 1).approved()).isFalse();
        MockPaymentProvider alwaysDown = new MockPaymentProvider(props(200, 0, 1.0));
        assertThatThrownBy(() -> alwaysDown.charge("b", 1)).isInstanceOf(ProviderUnavailableException.class);
        MockPaymentProvider healthy = new MockPaymentProvider(props(200, 0, 0));
        ChargeResult ok = healthy.charge("c", 1);
        assertThat(ok.approved()).isTrue();
        assertThat(ok.providerRef()).startsWith("ch_");
    }
}
