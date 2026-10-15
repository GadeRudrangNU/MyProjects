package com.trustpass.worker;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.trustpass.common.EmbeddedDatabase;
import com.trustpass.common.FieldCrypto;
import com.trustpass.common.JobType;
import java.net.ServerSocket;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.client.RestClient;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "trustpass.jobs.poll-millis=3600000",
        "logging.structured.format.console="
})
class WorkerTest {

    private static final FieldCrypto CRYPTO = new FieldCrypto("dev-only-encryption-secret-change-me");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) throws Exception {
        int dbPort = EmbeddedDatabase.start(0, null);
        String url = EmbeddedDatabase.jdbcUrl(dbPort);
        Flyway.configure().dataSource(url, "postgres", "postgres").locations("classpath:db/migration").load().migrate();
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "postgres");
        try (ServerSocket socket = new ServerSocket(0)) {
            int smtp = socket.getLocalPort();
            registry.add("trustpass.mail.smtp-port", () -> smtp);
        }
    }

    @LocalServerPort
    int port;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    JobRunner runner;
    @Autowired
    JobStore store;
    @Autowired
    EmbeddedMailServer mailbox;
    @Autowired
    ObjectMapper mapper;

    @BeforeEach
    void clean() {
        jdbc.update("delete from outbox_jobs");
    }

    private long enqueue(JobType type, Map<String, Object> payload) throws Exception {
        return jdbc.queryForObject("insert into outbox_jobs (type, payload, trace_id) values (?, cast(? as jsonb), 'trace-abc') returning id",
                Long.class, type.name(), mapper.writeValueAsString(payload));
    }

    private String status(long id) {
        return jdbc.queryForObject("select status from outbox_jobs where id = ?", String.class, id);
    }

    @Test
    void verificationEmailIsDeliveredWithTheDecryptedLink() throws Exception {
        String email = "mail-" + UUID.randomUUID().toString().substring(0, 6) + "@example.test";
        long id = enqueue(JobType.EMAIL_VERIFICATION, Map.of("email", email, "name", "Mia", "token", CRYPTO.encrypt("secret-token_1")));
        runner.poll();

        assertThat(status(id)).isEqualTo("DONE");
        var messages = mailbox.inbox(email);
        assertThat(messages).hasSize(1);
        assertThat(messages.get(0).subject()).isEqualTo("Verify your TrustPass email");
        assertThat(messages.get(0).body()).contains("http://localhost:5173/verify-email?token=secret-token_1").contains("Hi Mia");
    }

    @Test
    void everyNotificationTypeProducesAReadableEmail() throws Exception {
        String email = "all-" + UUID.randomUUID().toString().substring(0, 6) + "@example.test";
        String startsAt = "2026-11-02T14:00:00Z";
        Map<String, Object> booking = Map.of("email", email, "name", "Mia", "location", "Downtown Hub", "startsAt", startsAt);
        enqueue(JobType.BOOKING_CONFIRMED, booking);
        enqueue(JobType.BOOKING_CANCELLED, booking);
        enqueue(JobType.WAITLIST_PROMOTED, booking);
        enqueue(JobType.WAITLIST_JOINED, booking);
        enqueue(JobType.PAYMENT_SUCCEEDED, Map.of("email", email, "name", "Mia", "plan", "Basic", "amountCents", 999));
        enqueue(JobType.PAYMENT_FAILED, Map.of("email", email, "name", "Mia", "plan", "Basic", "amountCents", 1999, "reason", "card_declined"));
        enqueue(JobType.VERIFICATION_DECIDED, Map.of("email", email, "name", "Mia", "decision", "VERIFIED", "reason", ""));
        enqueue(JobType.VERIFICATION_DECIDED, Map.of("email", email, "name", "Mia", "decision", "REJECTED", "reason", "Photo is blurry"));
        runner.poll();

        assertThat(jdbc.queryForObject("select count(*) from outbox_jobs where status = 'DONE'", Long.class)).isEqualTo(8);
        var subjects = mailbox.inbox(email).stream().map(EmbeddedMailServer.Mail::subject).toList();
        assertThat(subjects).containsExactlyInAnyOrder("Booking confirmed", "Booking cancelled", "A spot opened up for you",
                "You are on the waitlist", "Payment received", "Your payment did not go through", "Your identity is verified",
                "Your identity verification needs attention");
        String all = String.join("\n", mailbox.inbox(email).stream().map(EmbeddedMailServer.Mail::body).toList());
        assertThat(all).contains("Mon 2 Nov 2026, 14:00 UTC").contains("$9.99").contains("$19.99").contains("Photo is blurry");
    }

    @Test
    void identityChecksMoveTheVerificationToReviewWithFlags() throws Exception {
        UUID userA = UUID.randomUUID();
        UUID userB = UUID.randomUUID();
        for (UUID u : List.of(userA, userB)) {
            jdbc.update("insert into users (id, email, name, email_verified) values (?, ?, 'Jane Doe', true)", u, u + "@example.test");
        }
        String sharedHash = "a".repeat(64);
        UUID first = insertVerification(userA, "Jane Doe", LocalDate.now().minusYears(30), LocalDate.now().plusYears(2), sharedHash, "f".repeat(64));
        UUID second = insertVerification(userB, "Someone Else", LocalDate.now().minusYears(30), LocalDate.now().minusDays(3), sharedHash, "e".repeat(64));

        enqueue(JobType.VERIFICATION_SUBMITTED, Map.of("verificationId", first.toString()));
        enqueue(JobType.VERIFICATION_SUBMITTED, Map.of("verificationId", second.toString()));
        runner.poll();

        assertThat(jdbc.queryForObject("select status from verifications where id = ?", String.class, first)).isEqualTo("IN_REVIEW");
        assertThat(flags(first)).containsExactly("DUPLICATE_DOCUMENT");
        assertThat(flags(second)).containsExactlyInAnyOrder("EXPIRED_DOCUMENT", "NAME_MISMATCH", "DUPLICATE_DOCUMENT");

        long again = enqueue(JobType.VERIFICATION_SUBMITTED, Map.of("verificationId", first.toString()));
        runner.poll();
        assertThat(status(again)).isEqualTo("DONE");
    }

    private List<String> flags(UUID id) throws Exception {
        String json = jdbc.queryForObject("select flags::text from verifications where id = ?", String.class, id);
        return mapper.readValue(json, mapper.getTypeFactory().constructCollectionType(List.class, String.class));
    }

    private UUID insertVerification(UUID user, String name, LocalDate dob, LocalDate expiry, String fileHash, String fingerprint) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into verifications (id, user_id, status, doc_type, storage_key, content_type, file_sha256, full_name,
                                           dob_enc, id_number_enc, id_number_fp, id_expiry)
                values (?, ?, 'PENDING', 'PASSPORT', 'x.png', 'image/png', ?, ?, ?, ?, ?, ?)
                """, id, user, fileHash, name, CRYPTO.encrypt(dob.toString()), CRYPTO.encrypt("ID1"), fingerprint, java.sql.Date.valueOf(expiry));
        return id;
    }

    @Test
    void failingJobsBackOffThenLandInTheDeadLetterState() throws Exception {
        long id = enqueue(JobType.EMAIL_VERIFICATION, Map.of("name", "No Recipient"));

        runner.poll();
        assertThat(status(id)).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("select attempts from outbox_jobs where id = ?", Integer.class, id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select next_run_at > now() + interval '3 seconds' from outbox_jobs where id = ?", Boolean.class, id)).isTrue();
        assertThat(jdbc.queryForObject("select last_error from outbox_jobs where id = ?", String.class, id)).contains("recipient");

        for (int attempt = 2; attempt <= 8; attempt++) {
            jdbc.update("update outbox_jobs set next_run_at = now() where id = ?", id);
            runner.poll();
        }
        assertThat(status(id)).isEqualTo("DEAD");
        assertThat(jdbc.queryForObject("select attempts from outbox_jobs where id = ?", Integer.class, id)).isEqualTo(8);

        jdbc.update("update outbox_jobs set next_run_at = now() where id = ?", id);
        runner.poll();
        assertThat(jdbc.queryForObject("select attempts from outbox_jobs where id = ?", Integer.class, id)).isEqualTo(8);
    }

    @Test
    void jobWithoutAHandlerOrWithCorruptPayloadFailsInsteadOfBlockingTheQueue() throws Exception {
        long bad = enqueue(JobType.EMAIL_VERIFICATION, Map.of("email", "x@example.test", "name", "X", "token", "not-encrypted"));
        long good = enqueue(JobType.BOOKING_CONFIRMED,
                Map.of("email", "ok-" + UUID.randomUUID().toString().substring(0, 6) + "@example.test", "name", "Y", "location", "L", "startsAt", "2026-11-02T14:00:00Z"));
        runner.poll();
        assertThat(status(bad)).isEqualTo("PENDING");
        assertThat(status(good)).isEqualTo("DONE");
    }

    @Test
    void jobsFromACrashedWorkerAreRecovered() throws Exception {
        long id = enqueue(JobType.BOOKING_CONFIRMED, Map.of("email", "r-" + UUID.randomUUID().toString().substring(0, 6) + "@example.test",
                "name", "R", "location", "L", "startsAt", "2026-11-02T14:00:00Z"));
        jdbc.update("update outbox_jobs set status = 'RUNNING', locked_by = 'ghost', locked_at = now() - interval '30 minutes' where id = ?", id);
        runner.poll();
        assertThat(status(id)).isEqualTo("DONE");
    }

    @Test
    void severalWorkersNeverProcessTheSameJobTwice() throws Exception {
        int jobs = 120;
        for (int i = 0; i < jobs; i++) {
            enqueue(JobType.BOOKING_CONFIRMED, Map.of("email", "c" + i + "@example.test", "name", "C"));
        }
        ConcurrentHashMap<Long, Integer> claimedBy = new ConcurrentHashMap<>();
        ExecutorService pool = Executors.newFixedThreadPool(4);
        List<Future<?>> futures = new ArrayList<>();
        for (int worker = 0; worker < 4; worker++) {
            int id = worker;
            futures.add(pool.submit(() -> {
                List<Job> batch;
                do {
                    batch = store.claim("worker-" + id, 7);
                    for (Job job : batch) {
                        assertThat(claimedBy.put(job.id(), id)).as("job %d claimed twice", job.id()).isNull();
                        store.markDone(job.id());
                    }
                } while (!batch.isEmpty());
            }));
        }
        for (Future<?> f : futures) {
            f.get();
        }
        pool.shutdown();
        assertThat(claimedBy).hasSize(jobs);
        assertThat(Set.copyOf(claimedBy.values())).hasSizeGreaterThan(1);
        assertThat(jdbc.queryForObject("select count(*) from outbox_jobs where status = 'DONE'", Long.class)).isEqualTo(jobs);
    }

    @Test
    void devMailboxEndpointListsAndClearsMessages() throws Exception {
        String email = "dev-" + UUID.randomUUID().toString().substring(0, 6) + "@example.test";
        enqueue(JobType.BOOKING_CONFIRMED, Map.of("email", email, "name", "D", "location", "L", "startsAt", "2026-11-02T14:00:00Z"));
        runner.poll();

        RestClient client = RestClient.create("http://localhost:" + port);
        List<?> inbox = client.get().uri("/dev/mail?to={to}", email).retrieve().body(List.class);
        assertThat(inbox).hasSize(1);
        assertThat(client.get().uri("/dev/mail?to=nobody@example.test").retrieve().body(List.class)).isEmpty();
        client.delete().uri("/dev/mail").retrieve().toBodilessEntity();
        assertThat(client.get().uri("/dev/mail").retrieve().body(List.class)).isEmpty();
    }

    @Test
    void metricsAreExposed() {
        RestClient client = RestClient.create("http://localhost:" + port);
        assertThat(client.get().uri("/actuator/health").retrieve().body(String.class)).contains("UP");
    }
}
