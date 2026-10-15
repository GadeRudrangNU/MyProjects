package com.trustpass.api.billing;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;

import com.trustpass.api.IntegrationTest;
import io.restassured.response.Response;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class BillingTest extends IntegrationTest {

    @Autowired
    private TestPaymentConfig.Controllable provider;

    @AfterEach
    void resetProvider() {
        provider.reset();
    }

    private Response subscribe(Account account, String plan, String key) {
        return json(account).header("Idempotency-Key", key).body(Map.of("planCode", plan)).post("/subscriptions");
    }

    private long payments(UUID userId) {
        return jdbc.queryForObject("select count(*) from payments where user_id = ?", Long.class, userId);
    }

    @Test
    void plansArePublic() {
        given().get("/plans").then().statusCode(200).body("$", hasSize(2)).body("[0].code", equalTo("BASIC"))
                .body("[1].code", equalTo("PLUS"));
    }

    @Test
    void subscribingTwiceWithTheSameKeyChargesOnce() {
        Account member = newMember();
        subscribe(member, "BASIC", "key-1").then().statusCode(201).body("status", equalTo("SUCCEEDED"))
                .body("subscription.planCode", equalTo("BASIC")).body("subscription.status", equalTo("ACTIVE"));
        Response replay = subscribe(member, "BASIC", "key-1");
        replay.then().statusCode(201).header("Idempotent-Replayed", "true");

        assertThat(payments(member.id())).isEqualTo(1);
        assertThat(provider.calls()).isEqualTo(1);
        assertThat(jobCount("PAYMENT_SUCCEEDED", member.email())).isEqualTo(1);
        json(member).get("/subscriptions/me").then().statusCode(200).body("$", hasSize(1));
        json(member).get("/payments/me").then().statusCode(200).body("$", hasSize(1)).body("[0].status", equalTo("SUCCEEDED"));
    }

    @Test
    void sameKeyWithDifferentRequestIsRejected() {
        Account member = newMember();
        subscribe(member, "BASIC", "key-2").then().statusCode(201);
        subscribe(member, "PLUS", "key-2").then().statusCode(422).body("code", equalTo("IDEMPOTENCY_KEY_REUSED"));
    }

    @Test
    void idempotencyKeyIsRequired() {
        Account member = newMember();
        json(member).body(Map.of("planCode", "BASIC")).post("/subscriptions").then().statusCode(400)
                .body("code", equalTo("MISSING_HEADER"));
    }

    @Test
    void unknownPlanAndSecondActiveSubscriptionAreRejected() {
        Account member = newMember();
        subscribe(member, "GOLD", "key-3").then().statusCode(400).body("code", equalTo("UNKNOWN_PLAN"));
        subscribe(member, "BASIC", "key-4").then().statusCode(201);
        subscribe(member, "PLUS", "key-5").then().statusCode(409).body("code", equalTo("ALREADY_SUBSCRIBED"));
    }

    @Test
    void declinedCardIsRecordedAndCanBeRetriedWithANewKey() {
        Account member = newMember();
        provider.willDecline();
        subscribe(member, "BASIC", "decline-1").then().statusCode(402).body("status", equalTo("FAILED"))
                .body("failureReason", equalTo("card_declined"));
        assertThat(jobCount("PAYMENT_FAILED", member.email())).isEqualTo(1);
        subscribe(member, "BASIC", "decline-1").then().statusCode(402).header("Idempotent-Replayed", "true");

        subscribe(member, "BASIC", "decline-2").then().statusCode(201);
        assertThat(payments(member.id())).isEqualTo(2);
    }

    @Test
    void providerOutageChargesNothingAndReleasesTheKey() {
        Account member = newMember();
        provider.willBeUnavailable();
        provider.willBeUnavailable();
        provider.willBeUnavailable();
        subscribe(member, "BASIC", "outage-1").then().statusCode(503).body("code", equalTo("PAYMENT_PROVIDER_UNAVAILABLE"));
        assertThat(payments(member.id())).isZero();
        assertThat(provider.calls()).isEqualTo(3);

        subscribe(member, "BASIC", "outage-1").then().statusCode(201);
        assertThat(payments(member.id())).isEqualTo(1);
    }

    @Test
    void aTransientFailureIsRetriedWithinTheSameRequest() {
        Account member = newMember();
        provider.willBeUnavailable();
        subscribe(member, "BASIC", "flaky-1").then().statusCode(201);
        assertThat(provider.calls()).isEqualTo(2);
        assertThat(payments(member.id())).isEqualTo(1);
    }

    @Test
    void concurrentDuplicateRequestsChargeOnce() throws Exception {
        Account member = newMember();
        provider.delay(600);
        ExecutorService pool = Executors.newFixedThreadPool(4);
        List<Callable<Integer>> calls = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            calls.add(() -> subscribe(member, "BASIC", "race-1").statusCode());
        }
        List<Integer> statuses = new ArrayList<>();
        for (Future<Integer> f : pool.invokeAll(calls)) {
            statuses.add(f.get());
        }
        pool.shutdown();

        assertThat(statuses).containsOnly(201, 409);
        assertThat(statuses).contains(201);
        assertThat(payments(member.id())).isEqualTo(1);
        assertThat(provider.calls()).isEqualTo(1);
    }

    @Test
    void renewExtendsThePeriodAndIsOwnedByTheMember() {
        Account member = newMember();
        String id = subscribe(member, "BASIC", "renew-0").path("subscription.id");
        String before = json(member).get("/subscriptions/me").path("[0].currentPeriodEnd");

        json(member).header("Idempotency-Key", "renew-1").post("/subscriptions/" + id + "/renew").then().statusCode(201)
                .body("subscription.id", equalTo(id));
        String after = json(member).get("/subscriptions/me").path("[0].currentPeriodEnd");
        assertThat(java.time.Instant.parse(after)).isAfter(java.time.Instant.parse(before));

        Account other = newMember();
        json(other).header("Idempotency-Key", "renew-2").post("/subscriptions/" + id + "/renew").then().statusCode(404);
        json(other).post("/subscriptions/" + id + "/cancel").then().statusCode(404);
    }

    @Test
    void cancelEndsMembershipAndBlocksFurtherRenewal() {
        Account member = newMember();
        String id = subscribe(member, "BASIC", "cancel-0").path("subscription.id");
        json(member).post("/subscriptions/" + id + "/cancel").then().statusCode(200).body("status", equalTo("CANCELLED"))
                .body("cancelledAt", notNullValue());
        json(member).post("/subscriptions/" + id + "/cancel").then().statusCode(409);
        json(member).header("Idempotency-Key", "cancel-1").post("/subscriptions/" + id + "/renew").then().statusCode(409);
        subscribe(member, "PLUS", "cancel-2").then().statusCode(201);
    }
}
