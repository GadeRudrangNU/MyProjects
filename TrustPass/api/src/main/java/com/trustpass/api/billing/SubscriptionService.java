package com.trustpass.api.billing;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trustpass.api.audit.AuditService;
import com.trustpass.api.billing.PaymentProvider.ChargeResult;
import com.trustpass.api.billing.PaymentProvider.ProviderUnavailableException;
import com.trustpass.api.notifications.OutboxService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.Hashing;
import com.trustpass.api.users.User;
import com.trustpass.api.users.UserService;
import com.trustpass.common.JobType;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class SubscriptionService {

    static final String ACTIVE = "ACTIVE";
    static final String CANCELLED = "CANCELLED";

    private final PlanRepository plans;
    private final SubscriptionRepository subscriptions;
    private final PaymentRepository payments;
    private final IdempotencyService idempotency;
    private final ResilientPaymentGateway gateway;
    private final OutboxService outbox;
    private final UserService users;
    private final AuditService audit;
    private final ObjectMapper mapper;
    private final Clock clock;
    private final TransactionTemplate tx;

    SubscriptionService(PlanRepository plans, SubscriptionRepository subscriptions, PaymentRepository payments,
                        IdempotencyService idempotency, ResilientPaymentGateway gateway, OutboxService outbox,
                        UserService users, AuditService audit, ObjectMapper mapper, Clock clock,
                        PlatformTransactionManager txManager) {
        this.plans = plans;
        this.subscriptions = subscriptions;
        this.payments = payments;
        this.idempotency = idempotency;
        this.gateway = gateway;
        this.outbox = outbox;
        this.users = users;
        this.audit = audit;
        this.mapper = mapper;
        this.clock = clock;
        this.tx = new TransactionTemplate(txManager);
    }

    record Reply(int status, String body, boolean replayed) {
    }

    public boolean hasActiveMembership(UUID userId) {
        return subscriptions.existsByUserIdAndStatusAndCurrentPeriodEndAfter(userId, ACTIVE, clock.instant());
    }

    Reply subscribe(UUID userId, String planCode, String key) {
        Plan plan = plans.findByCode(planCode.toUpperCase())
                .orElseThrow(() -> ApiException.badRequest("UNKNOWN_PLAN", "Unknown plan"));
        return charge(userId, key, Hashing.sha256Hex("subscribe|" + plan.getCode()), plan, null, "SUBSCRIBE");
    }

    Reply renew(UUID userId, UUID subscriptionId, String key) {
        Subscription sub = subscriptions.findById(subscriptionId)
                .filter(s -> s.getUserId().equals(userId))
                .orElseThrow(() -> ApiException.notFound("Subscription"));
        if (!ACTIVE.equals(sub.getStatus())) {
            throw ApiException.conflict("SUBSCRIPTION_NOT_ACTIVE", "Only active subscriptions can be renewed");
        }
        Plan plan = plans.findById(sub.getPlanId()).orElseThrow();
        return charge(userId, key, Hashing.sha256Hex("renew|" + subscriptionId), plan, sub.getId(), "RENEW");
    }

    @Transactional
    Subscription cancel(UUID userId, UUID subscriptionId) {
        Subscription sub = subscriptions.findById(subscriptionId)
                .filter(s -> s.getUserId().equals(userId))
                .orElseThrow(() -> ApiException.notFound("Subscription"));
        if (!ACTIVE.equals(sub.getStatus())) {
            throw ApiException.conflict("SUBSCRIPTION_NOT_ACTIVE", "The subscription is not active");
        }
        sub.setStatus(CANCELLED);
        sub.setCancelledAt(clock.instant());
        audit.record("SUBSCRIPTION_CANCELLED", "SUBSCRIPTION", subscriptionId.toString(), Map.of());
        return subscriptions.save(sub);
    }

    @Transactional(readOnly = true)
    List<Subscription> forUser(UUID userId) {
        return subscriptions.findByUserIdOrderByStartedAtDesc(userId);
    }

    @Transactional(readOnly = true)
    List<Payment> paymentsFor(UUID userId) {
        return payments.findByUserIdOrderByCreatedAtDesc(userId);
    }

    @Cacheable("plans")
    public List<BillingController.PlanView> listPlans() {
        return plans.findAll().stream()
                .sorted(Comparator.comparingInt(Plan::getPriceCents))
                .map(BillingController.PlanView::of).toList();
    }

    @Transactional(readOnly = true)
    Plan plan(UUID id) {
        return plans.findById(id).orElseThrow();
    }

    private Reply charge(UUID userId, String key, String requestHash, Plan plan, UUID renewing, String kind) {
        Optional<IdempotencyService.Stored> replay = idempotency.claim(userId, key, requestHash);
        if (replay.isPresent()) {
            return new Reply(replay.get().status(), replay.get().body(), true);
        }
        if (renewing == null && subscriptions.findByUserIdAndStatus(userId, ACTIVE).isPresent()) {
            idempotency.release(userId, key);
            throw ApiException.conflict("ALREADY_SUBSCRIBED", "You already have an active membership");
        }
        ChargeResult result;
        try {
            result = gateway.charge(userId + ":" + key, plan.getPriceCents());
        } catch (ProviderUnavailableException e) {
            idempotency.release(userId, key);
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENT_PROVIDER_UNAVAILABLE",
                    "The payment provider is not responding. Nothing was charged, please try again.");
        } catch (RuntimeException e) {
            idempotency.release(userId, key);
            throw e;
        }
        return tx.execute(status -> settle(userId, key, plan, renewing, kind, result));
    }

    private Reply settle(UUID userId, String key, Plan plan, UUID renewing, String kind, ChargeResult result) {
        User user = users.get(userId);
        Payment payment = new Payment();
        payment.setUserId(userId);
        payment.setPlanId(plan.getId());
        payment.setKind(kind);
        payment.setAmountCents(plan.getPriceCents());
        payment.setProviderRef(result.providerRef());
        payment.setIdempotencyKey(key);
        Map<String, Object> mail = Map.of("email", user.getEmail(), "name", user.getName(),
                "plan", plan.getName(), "amountCents", plan.getPriceCents());

        Reply reply;
        if (result.approved()) {
            Subscription sub = renewing == null ? newSubscription(userId, plan) : extend(renewing, plan);
            payment.setStatus("SUCCEEDED");
            payment.setSubscriptionId(sub.getId());
            payments.saveAndFlush(payment);
            outbox.enqueue(JobType.PAYMENT_SUCCEEDED, mail);
            audit.record("PAYMENT_SUCCEEDED", "PAYMENT", payment.getId().toString(), Map.of("plan", plan.getCode()));
            reply = new Reply(HttpStatus.CREATED.value(), json(BillingController.PaymentResult.succeeded(
                    payment, BillingController.SubscriptionView.of(sub, plan))), false);
        } else {
            payment.setStatus("FAILED");
            payment.setFailureReason(result.failureReason());
            payments.saveAndFlush(payment);
            outbox.enqueue(JobType.PAYMENT_FAILED, Map.of("email", user.getEmail(), "name", user.getName(),
                    "plan", plan.getName(), "amountCents", plan.getPriceCents(),
                    "reason", result.failureReason()));
            audit.record("PAYMENT_FAILED", "PAYMENT", payment.getId().toString(), Map.of("reason", result.failureReason()));
            reply = new Reply(HttpStatus.PAYMENT_REQUIRED.value(), json(BillingController.PaymentResult.failed(
                    payment)), false);
        }
        idempotency.complete(userId, key, reply.status(), reply.body());
        return reply;
    }

    private Subscription newSubscription(UUID userId, Plan plan) {
        Subscription sub = new Subscription();
        sub.setUserId(userId);
        sub.setPlanId(plan.getId());
        sub.setStatus(ACTIVE);
        sub.setCurrentPeriodEnd(clock.instant().plus(Duration.ofDays(plan.getPeriodDays())));
        return subscriptions.saveAndFlush(sub);
    }

    private Subscription extend(UUID subscriptionId, Plan plan) {
        Subscription sub = subscriptions.findById(subscriptionId).orElseThrow();
        Instant base = sub.getCurrentPeriodEnd().isAfter(clock.instant()) ? sub.getCurrentPeriodEnd() : clock.instant();
        sub.setCurrentPeriodEnd(base.plus(Duration.ofDays(plan.getPeriodDays())));
        return subscriptions.save(sub);
    }

    private String json(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
