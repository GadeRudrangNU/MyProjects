package com.trustpass.api.booking;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.notNullValue;

import com.trustpass.api.IntegrationTest;
import com.trustpass.api.shared.Role;
import io.restassured.response.Response;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

class BookingTest extends IntegrationTest {

    private Account admin() {
        return newAccount(Role.ADMIN);
    }

    private String createLocation(Account admin) {
        return json(admin).body(Map.of("name", "Site " + UUID.randomUUID().toString().substring(0, 6), "address", "1 Test Way"))
                .post("/admin/locations").then().statusCode(201).extract().path("id");
    }

    private String createSlot(Account admin, String locationId, int capacity) {
        Instant start = Instant.now().plus(2, ChronoUnit.DAYS);
        return json(admin).body(Map.of("startsAt", start.toString(), "endsAt", start.plus(1, ChronoUnit.HOURS).toString(),
                        "capacity", capacity))
                .post("/admin/locations/" + locationId + "/slots").then().statusCode(201).extract().path("id");
    }

    private Response book(Account account, String slotId) {
        return json(account).body(Map.of("slotId", slotId)).post("/bookings");
    }

    private String slotId(Account admin, int capacity) {
        return createSlot(admin, createLocation(admin), capacity);
    }

    @Test
    void memberBooksSeesTheBookingAndCancels() {
        Account admin = admin();
        String locationId = createLocation(admin);
        String slotId = createSlot(admin, locationId, 2);
        Account member = newMemberWithMembership();

        String bookingId = book(member, slotId).then().statusCode(201).body("status", equalTo("CONFIRMED"))
                .body("slotId", equalTo(slotId)).extract().path("id");
        book(member, slotId).then().statusCode(409).body("code", equalTo("ALREADY_BOOKED"));

        json(member).get("/locations/" + locationId + "/slots").then().statusCode(200)
                .body("[0].booked", equalTo(1)).body("[0].available", equalTo(1)).body("[0].myBookingId", equalTo(bookingId));
        json(member).get("/bookings/me").then().statusCode(200).body("[0].id", equalTo(bookingId));
        assertThat(jobCount("BOOKING_CONFIRMED", member.email())).isEqualTo(1);

        json(member).delete("/bookings/" + bookingId).then().statusCode(204);
        json(member).delete("/bookings/" + bookingId).then().statusCode(409).body("code", equalTo("BOOKING_NOT_ACTIVE"));
        json(member).get("/locations/" + locationId + "/slots").then().body("[0].booked", equalTo(0));
        assertThat(jobCount("BOOKING_CANCELLED", member.email())).isEqualTo(1);
    }

    @Test
    void bookingRequiresAnActiveMembership() {
        Account admin = admin();
        String slotId = slotId(admin, 2);
        Account member = newMember();
        book(member, slotId).then().statusCode(403).body("code", equalTo("MEMBERSHIP_REQUIRED"));

        grantMembership(member.id());
        jdbc.update("update subscriptions set current_period_end = now() - interval '1 day' where user_id = ?", member.id());
        book(member, slotId).then().statusCode(403);
    }

    @Test
    void slotsInThePastAreRejected() {
        Account admin = admin();
        String slotId = slotId(admin, 2);
        jdbc.update("update slots set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = ?::uuid", slotId);
        book(newMemberWithMembership(), slotId).then().statusCode(400).body("code", equalTo("SLOT_IN_PAST"));
    }

    @Test
    void neverBooksMorePeopleThanTheCapacityUnderConcurrentLoad() throws Exception {
        Account admin = admin();
        String slotId = slotId(admin, 3);
        int contenders = 12;
        List<Account> members = new ArrayList<>();
        for (int i = 0; i < contenders; i++) {
            members.add(newMemberWithMembership());
        }
        ExecutorService pool = Executors.newFixedThreadPool(contenders);
        CountDownLatch start = new CountDownLatch(1);
        List<Callable<Integer>> tasks = new ArrayList<>();
        for (Account member : members) {
            tasks.add(() -> {
                start.await();
                return book(member, slotId).statusCode();
            });
        }
        List<Future<Integer>> futures = new ArrayList<>();
        for (Callable<Integer> task : tasks) {
            futures.add(pool.submit(task));
        }
        start.countDown();
        int created = 0;
        int full = 0;
        for (Future<Integer> future : futures) {
            int status = future.get();
            if (status == 201) {
                created++;
            } else if (status == 409) {
                full++;
            }
        }
        pool.shutdown();

        assertThat(created).isEqualTo(3);
        assertThat(full).isEqualTo(contenders - 3);
        assertThat(jdbc.queryForObject("select booked_count from slots where id = ?::uuid", Integer.class, slotId)).isEqualTo(3);
        assertThat(jdbc.queryForObject("select count(*) from bookings where slot_id = ?::uuid and status = 'CONFIRMED'", Integer.class, slotId)).isEqualTo(3);
    }

    @Test
    void firstEligibleWaitlistedMemberGetsTheFreedSpot() {
        Account admin = admin();
        String slotId = slotId(admin, 1);
        Account holder = newMemberWithMembership();
        Account lapsed = newMemberWithMembership();
        Account next = newMemberWithMembership();
        Account last = newMemberWithMembership();
        String holderBooking = book(holder, slotId).then().statusCode(201).extract().path("id");

        json(lapsed).post("/slots/" + slotId + "/waitlist").then().statusCode(201);
        json(next).post("/slots/" + slotId + "/waitlist").then().statusCode(201);
        json(last).post("/slots/" + slotId + "/waitlist").then().statusCode(201);
        json(next).post("/slots/" + slotId + "/waitlist").then().statusCode(409).body("code", equalTo("ALREADY_WAITLISTED"));
        jdbc.update("update subscriptions set current_period_end = now() - interval '1 day' where user_id = ?", lapsed.id());

        json(holder).delete("/bookings/" + holderBooking).then().statusCode(204);

        json(next).get("/bookings/me").then().body("[0].status", equalTo("CONFIRMED"));
        json(last).get("/bookings/me").then().body("size()", equalTo(0));
        json(lapsed).get("/bookings/me").then().body("size()", equalTo(0));
        assertThat(jobCount("WAITLIST_PROMOTED", next.email())).isEqualTo(1);
        assertThat(jobCount("BOOKING_CONFIRMED", next.email())).isZero();
        assertThat(jdbc.queryForObject("select status from waitlist where slot_id = ?::uuid and user_id = ?", String.class, slotId, lapsed.id())).isEqualTo("CANCELLED");
        assertThat(jdbc.queryForObject("select status from waitlist where slot_id = ?::uuid and user_id = ?", String.class, slotId, last.id())).isEqualTo("WAITING");
    }

    @Test
    void waitlistRulesAreEnforced() {
        Account admin = admin();
        String slotId = slotId(admin, 1);
        Account first = newMemberWithMembership();
        Account second = newMemberWithMembership();

        json(second).post("/slots/" + slotId + "/waitlist").then().statusCode(409).body("code", equalTo("SLOT_AVAILABLE"));
        book(first, slotId).then().statusCode(201);
        book(second, slotId).then().statusCode(409).body("code", equalTo("SLOT_FULL"));
        json(first).post("/slots/" + slotId + "/waitlist").then().statusCode(409).body("code", equalTo("ALREADY_BOOKED"));
        newMember();
        json(newMember()).post("/slots/" + slotId + "/waitlist").then().statusCode(403);

        json(second).post("/slots/" + slotId + "/waitlist").then().statusCode(201).body("joined", equalTo(true));
        json(second).delete("/slots/" + slotId + "/waitlist").then().statusCode(204);
        json(second).delete("/slots/" + slotId + "/waitlist").then().statusCode(404);
    }

    @Test
    void onlyTheOwnerOrStaffCanCancel() {
        Account admin = admin();
        String slotId = slotId(admin, 2);
        Account owner = newMemberWithMembership();
        Account stranger = newMemberWithMembership();
        Account support = newAccount(Role.SUPPORT);
        String bookingId = book(owner, slotId).then().statusCode(201).extract().path("id");

        json(stranger).delete("/bookings/" + bookingId).then().statusCode(404);
        json(support).delete("/bookings/" + bookingId).then().statusCode(204);
        assertThat(jdbc.queryForObject("select count(*) from audit_log where action = 'BOOKING_CANCELLED' and target_id = ?", Long.class, bookingId)).isEqualTo(1);
    }

    @Test
    void onlyAdminsManageLocationsAndSlotsAndInputIsValidated() {
        Account member = newMember();
        json(member).body(Map.of("name", "X", "address", "Y")).post("/admin/locations").then().statusCode(403);
        Account admin = admin();
        json(admin).body(Map.of("name", "", "address", "Y")).post("/admin/locations").then().statusCode(400);

        String locationId = createLocation(admin);
        Instant start = Instant.now().plus(1, ChronoUnit.DAYS);
        json(admin).body(Map.of("startsAt", start.toString(), "endsAt", start.minusSeconds(60).toString(), "capacity", 2))
                .post("/admin/locations/" + locationId + "/slots").then().statusCode(400).body("code", equalTo("INVALID_RANGE"));
        json(admin).body(Map.of("startsAt", start.toString(), "endsAt", start.plusSeconds(3600).toString(), "capacity", 0))
                .post("/admin/locations/" + locationId + "/slots").then().statusCode(400);
        json(admin).body(Map.of("startsAt", start.toString(), "endsAt", start.plusSeconds(3600).toString(), "capacity", 2))
                .post("/admin/locations/" + UUID.randomUUID() + "/slots").then().statusCode(404);
        json(member).get("/locations/" + UUID.randomUUID() + "/slots").then().statusCode(404);
        json(member).body(Map.of("slotId", UUID.randomUUID().toString())).post("/bookings").then().statusCode(403);
        json(newMemberWithMembership()).body(Map.of("slotId", UUID.randomUUID().toString())).post("/bookings").then().statusCode(404);
    }

    @Test
    void newLocationsShowUpInTheCachedList() {
        Account admin = admin();
        Account member = newMember();
        json(member).get("/locations").then().statusCode(200).body("name", notNullValue());
        String id = createLocation(admin);
        json(member).get("/locations").then().body("id", hasItem(id));
        given().get("/locations").then().statusCode(401);
    }
}
