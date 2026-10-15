package com.trustpass.api.billing;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

@TestConfiguration
public class TestPaymentConfig {

    public static class Controllable implements PaymentProvider {

        private final Deque<Supplier<ChargeResult>> script = new ArrayDeque<>();
        private final AtomicInteger calls = new AtomicInteger();
        private volatile long delayMillis;

        public synchronized void willApprove() {
            script.add(() -> new ChargeResult(true, "ch_test", null));
        }

        public synchronized void willDecline() {
            script.add(() -> new ChargeResult(false, null, "card_declined"));
        }

        public synchronized void willBeUnavailable() {
            script.add(() -> {
                throw new ProviderUnavailableException("503");
            });
        }

        public void delay(long millis) {
            this.delayMillis = millis;
        }

        public int calls() {
            return calls.get();
        }

        public synchronized void reset() {
            script.clear();
            calls.set(0);
            delayMillis = 0;
        }

        @Override
        public ChargeResult charge(String reference, int amountCents) {
            calls.incrementAndGet();
            if (delayMillis > 0) {
                try {
                    Thread.sleep(delayMillis);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            Supplier<ChargeResult> next;
            synchronized (this) {
                next = script.poll();
            }
            return next == null ? new ChargeResult(true, "ch_default", null) : next.get();
        }
    }

    @Bean
    @Primary
    Controllable controllablePaymentProvider() {
        return new Controllable();
    }
}
