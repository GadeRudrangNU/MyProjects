package com.trustpass.api.billing;

import com.trustpass.api.shared.TrustPassProperties;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Component;

@Component
class MockPaymentProvider implements PaymentProvider {

    private final TrustPassProperties.Payment config;
    private final Map<String, ChargeResult> processed = new ConcurrentHashMap<>();

    MockPaymentProvider(TrustPassProperties props) {
        this.config = props.payment();
    }

    @Override
    public ChargeResult charge(String reference, int amountCents) {
        ChargeResult previous = processed.get(reference);
        if (previous != null) {
            return previous;
        }
        ThreadLocalRandom random = ThreadLocalRandom.current();
        pause(random.nextInt(config.minLatencyMs(), Math.max(config.minLatencyMs() + 1, config.maxLatencyMs())));
        if (random.nextDouble() < config.outageRate()) {
            throw new ProviderUnavailableException("provider returned 503");
        }
        ChargeResult result = random.nextDouble() < config.declineRate()
                ? new ChargeResult(false, null, "card_declined")
                : new ChargeResult(true, "ch_" + UUID.randomUUID().toString().replace("-", "").substring(0, 18), null);
        processed.put(reference, result);
        return result;
    }

    private static void pause(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ProviderUnavailableException("interrupted", e);
        }
    }
}
