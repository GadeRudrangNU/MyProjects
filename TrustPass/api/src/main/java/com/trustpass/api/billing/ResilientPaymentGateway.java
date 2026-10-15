package com.trustpass.api.billing;

import com.trustpass.api.billing.PaymentProvider.ChargeResult;
import com.trustpass.api.billing.PaymentProvider.ProviderUnavailableException;
import com.trustpass.api.shared.TrustPassProperties;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.micrometer.tagged.TaggedCircuitBreakerMetrics;
import io.github.resilience4j.micrometer.tagged.TaggedRetryMetrics;
import io.github.resilience4j.retry.Retry;
import io.github.resilience4j.retry.RetryConfig;
import io.github.resilience4j.retry.RetryRegistry;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

@Component
class ResilientPaymentGateway {

    private final PaymentProvider provider;
    private final TrustPassProperties.Payment config;
    private final CircuitBreaker breaker;
    private final Retry retry;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    ResilientPaymentGateway(PaymentProvider provider, TrustPassProperties props, MeterRegistry metrics) {
        this.provider = provider;
        this.config = props.payment();
        CircuitBreakerRegistry breakers = CircuitBreakerRegistry.of(CircuitBreakerConfig.custom()
                .slidingWindowSize(10)
                .minimumNumberOfCalls(6)
                .failureRateThreshold(60)
                .waitDurationInOpenState(Duration.ofSeconds(10))
                .permittedNumberOfCallsInHalfOpenState(2)
                .recordExceptions(ProviderUnavailableException.class)
                .build());
        RetryRegistry retries = RetryRegistry.of(RetryConfig.custom()
                .maxAttempts(3)
                .waitDuration(Duration.ofMillis(150))
                .retryExceptions(ProviderUnavailableException.class)
                .build());
        this.breaker = breakers.circuitBreaker("payment-provider");
        this.retry = retries.retry("payment-provider");
        TaggedCircuitBreakerMetrics.ofCircuitBreakerRegistry(breakers).bindTo(metrics);
        TaggedRetryMetrics.ofRetryRegistry(retries).bindTo(metrics);
    }

    ChargeResult charge(String reference, int amountCents) {
        Supplier<ChargeResult> guarded = CircuitBreaker.decorateSupplier(breaker,
                () -> withTimeout(reference, amountCents));
        try {
            return Retry.decorateSupplier(retry, guarded).get();
        } catch (CallNotPermittedException e) {
            throw new ProviderUnavailableException("payment provider circuit is open", e);
        }
    }

    private ChargeResult withTimeout(String reference, int amountCents) {
        Future<ChargeResult> future = executor.submit(() -> provider.charge(reference, amountCents));
        try {
            return future.get(config.timeoutMs(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            throw new ProviderUnavailableException("provider timed out", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ProviderUnavailableException("interrupted", e);
        } catch (ExecutionException e) {
            if (e.getCause() instanceof ProviderUnavailableException unavailable) {
                throw unavailable;
            }
            throw new ProviderUnavailableException("provider failed", e.getCause());
        }
    }
}
