package com.trustpass.api.billing;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trustpass.api.shared.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
class BillingController {

    private final SubscriptionService service;
    private final ObjectMapper mapper;

    BillingController(SubscriptionService service, ObjectMapper mapper) {
        this.service = service;
        this.mapper = mapper;
    }

    @GetMapping("/plans")
    List<PlanView> listPlans() {
        return service.listPlans();
    }

    @PostMapping("/subscriptions")
    ResponseEntity<PaymentResult> subscribe(@RequestHeader("Idempotency-Key") @NotBlank @Size(max = 120) String key,
                                            @Valid @RequestBody SubscribeRequest body) {
        return toResponse(service.subscribe(CurrentUser.require().id(), body.planCode(), key));
    }

    @PostMapping("/subscriptions/{id}/renew")
    ResponseEntity<PaymentResult> renewSubscription(@RequestHeader("Idempotency-Key") @NotBlank @Size(max = 120) String key,
                                        @PathVariable UUID id) {
        return toResponse(service.renew(CurrentUser.require().id(), id, key));
    }

    @PostMapping("/subscriptions/{id}/cancel")
    SubscriptionView cancelSubscription(@PathVariable UUID id) {
        Subscription sub = service.cancel(CurrentUser.require().id(), id);
        return SubscriptionView.of(sub, service.plan(sub.getPlanId()));
    }

    @GetMapping("/subscriptions/me")
    List<SubscriptionView> listMySubscriptions() {
        return service.forUser(CurrentUser.require().id()).stream()
                .map(s -> SubscriptionView.of(s, service.plan(s.getPlanId()))).toList();
    }

    @GetMapping("/payments/me")
    List<PaymentView> listMyPayments() {
        return service.paymentsFor(CurrentUser.require().id()).stream().map(PaymentView::of).toList();
    }

    private ResponseEntity<PaymentResult> toResponse(SubscriptionService.Reply reply) {
        ResponseEntity.BodyBuilder builder = ResponseEntity.status(HttpStatusCode.valueOf(reply.status()))
                .contentType(MediaType.APPLICATION_JSON);
        if (reply.replayed()) {
            builder.header("Idempotent-Replayed", "true");
        }
        return builder.body(parse(reply.body()));
    }

    private PaymentResult parse(String body) {
        try {
            return mapper.readValue(body, PaymentResult.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    record SubscribeRequest(@NotBlank String planCode) {
    }

    record PlanView(UUID id, String code, String name, String description, int priceCents, int periodDays) {

        static PlanView of(Plan p) {
            return new PlanView(p.getId(), p.getCode(), p.getName(), p.getDescription(), p.getPriceCents(),
                    p.getPeriodDays());
        }
    }

    record SubscriptionView(UUID id, String planCode, String planName, String status, Instant startedAt,
                            Instant currentPeriodEnd, Instant cancelledAt) {

        static SubscriptionView of(Subscription s, Plan p) {
            return new SubscriptionView(s.getId(), p.getCode(), p.getName(), s.getStatus(), s.getStartedAt(),
                    s.getCurrentPeriodEnd(), s.getCancelledAt());
        }
    }

    record PaymentView(UUID id, String kind, int amountCents, String status, String failureReason, Instant createdAt) {

        static PaymentView of(Payment p) {
            return new PaymentView(p.getId(), p.getKind(), p.getAmountCents(), p.getStatus(), p.getFailureReason(),
                    p.getCreatedAt());
        }
    }

    record PaymentResult(UUID paymentId, String status, SubscriptionView subscription, String failureReason) {

        static PaymentResult succeeded(Payment p, SubscriptionView sub) {
            return new PaymentResult(p.getId(), p.getStatus(), sub, null);
        }

        static PaymentResult failed(Payment p) {
            return new PaymentResult(p.getId(), p.getStatus(), null, p.getFailureReason());
        }
    }
}
