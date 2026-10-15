package com.trustpass.api.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;

import com.trustpass.api.IntegrationTest;
import com.trustpass.api.shared.Role;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class VerificationTest extends IntegrationTest {

    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8};

    private RequestSpecification upload(Account account, byte[] bytes, String filename, String mime) {
        return as(account).multiPart("document", filename, bytes, mime)
                .multiPart("docType", "PASSPORT")
                .multiPart("fullName", "Test member")
                .multiPart("dateOfBirth", LocalDate.now().minusYears(30).toString())
                .multiPart("idNumber", "X1234567" + UUID.randomUUID().toString().substring(0, 4).toUpperCase())
                .multiPart("idExpiry", LocalDate.now().plusYears(3).toString());
    }

    private String submit(Account account) {
        return upload(account, PNG, "id.png", "image/png").post("/verifications").then().statusCode(201)
                .body("status", equalTo("PENDING")).extract().path("id");
    }

    private void workerMovesToReview(String id) {
        jdbc.update("update verifications set status = 'IN_REVIEW' where id = ?::uuid", id);
    }

    @Test
    void uploadCreatesAPendingVerificationWithEncryptedFields() {
        Account member = newMember();
        String id = submit(member);

        assertThat(jdbc.queryForObject("select count(*) from outbox_jobs where type = 'VERIFICATION_SUBMITTED' and payload->>'verificationId' = ?", Long.class, id)).isEqualTo(1);

        String storedDob = jdbc.queryForObject("select dob_enc from verifications where id = ?::uuid", String.class, id);
        String storedNumber = jdbc.queryForObject("select id_number_enc from verifications where id = ?::uuid", String.class, id);
        assertThat(storedDob).doesNotContain(LocalDate.now().minusYears(30).toString());
        assertThat(crypto.decrypt(storedDob)).isEqualTo(LocalDate.now().minusYears(30).toString());
        assertThat(crypto.decrypt(storedNumber)).startsWith("X1234567");
        assertThat(jdbc.queryForObject("select length(file_sha256) from verifications where id = ?::uuid", Integer.class, id)).isEqualTo(64);

        as(member).get("/verifications/me").then().statusCode(200).body("[0].status", equalTo("PENDING"));
        upload(member, PNG, "id.png", "image/png").post("/verifications").then().statusCode(409)
                .body("code", equalTo("VERIFICATION_OPEN"));
    }

    @Test
    void onlyJpegPngAndPdfUnderTheSizeLimitAreAccepted() {
        Account member = newMember();
        upload(member, "plain text".getBytes(), "id.png", "image/png").post("/verifications").then().statusCode(415)
                .body("code", equalTo("UNSUPPORTED_FILE_TYPE"));
        upload(member, new byte[5 * 1024 * 1024 + 100], "big.png", "image/png").post("/verifications").then().statusCode(413);
        byte[] pdf = "%PDF-1.4 test content".getBytes();
        upload(member, pdf, "id.pdf", "application/pdf").post("/verifications").then().statusCode(201);
        byte[] jpeg = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 16, 'J', 'F', 'I', 'F'};
        upload(newMember(), jpeg, "id.jpg", "image/jpeg").post("/verifications").then().statusCode(201);
    }

    @Test
    void invalidFormFieldsAreRejected() {
        Account member = newMember();
        as(member).multiPart("document", "id.png", PNG, "image/png").multiPart("docType", "PASSPORT")
                .multiPart("fullName", "Test").multiPart("dateOfBirth", LocalDate.now().minusYears(30).toString())
                .multiPart("idNumber", "!!").multiPart("idExpiry", LocalDate.now().plusYears(1).toString())
                .post("/verifications").then().statusCode(400);
        as(member).multiPart("document", "id.png", PNG, "image/png").multiPart("docType", "PASSPORT")
                .multiPart("fullName", "Test").multiPart("dateOfBirth", LocalDate.now().plusDays(3).toString())
                .multiPart("idNumber", "ABCD1234").multiPart("idExpiry", LocalDate.now().plusYears(1).toString())
                .post("/verifications").then().statusCode(400).body("code", equalTo("INVALID_DATE_OF_BIRTH"));
        as(member).multiPart("docType", "PASSPORT").post("/verifications").then().statusCode(400);
    }

    @Test
    void reviewerApprovesAndTheMemberBecomesVerified() {
        Account member = newMember();
        Account reviewer = newAccount(Role.REVIEWER);
        String id = submit(member);
        workerMovesToReview(id);

        as(member).get("/admin/verifications").then().statusCode(403);
        as(reviewer).get("/admin/verifications?status=IN_REVIEW").then().statusCode(200)
                .body("items.id", hasItem(id));
        as(reviewer).get("/admin/verifications/" + id).then().statusCode(200).body("idNumberMasked", containsString("****"))
                .body("userEmail", equalTo(member.email()));

        byte[] document = as(reviewer).get("/admin/verifications/" + id + "/document").then().statusCode(200).extract().asByteArray();
        assertThat(document).isEqualTo(PNG);
        as(member).get("/admin/verifications/" + id + "/document").then().statusCode(403);

        json(reviewer).body(Map.of("decision", "APPROVE")).post("/admin/verifications/" + id + "/decision").then()
                .statusCode(200).body("status", equalTo("VERIFIED"));
        as(member).get("/me").then().body("identityVerified", equalTo(true)).body("ageOver21", equalTo(true));
        assertThat(jdbc.queryForObject("select count(*) from outbox_jobs where type = 'VERIFICATION_DECIDED' and payload->>'email' = ?", Long.class, member.email())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from audit_log where action = 'VERIFICATION_APPROVED' and target_id = ?", Long.class, id)).isEqualTo(1);

        json(reviewer).body(Map.of("decision", "REJECT", "reason", "changed my mind")).post("/admin/verifications/" + id + "/decision")
                .then().statusCode(409).body("code", equalTo("INVALID_TRANSITION"));
        upload(member, PNG, "id.png", "image/png").post("/verifications").then().statusCode(409).body("code", equalTo("ALREADY_VERIFIED"));
    }

    @Test
    void under21MembersAreVerifiedButNotFlaggedAsOver21() {
        Account member = newMember();
        Account reviewer = newAccount(Role.REVIEWER);
        String id = submit(member);
        jdbc.update("update verifications set dob_enc = ?, status = 'IN_REVIEW' where id = ?::uuid",
                crypto.encrypt(LocalDate.now().minusYears(19).toString()), id);
        json(reviewer).body(Map.of("decision", "APPROVE")).post("/admin/verifications/" + id + "/decision").then().statusCode(200);
        as(member).get("/me").then().body("identityVerified", equalTo(true)).body("ageOver21", equalTo(false));
    }

    @Test
    void stateMachineRejectsInvalidTransitionsAndRequiresAReasonToReject() {
        Account member = newMember();
        Account reviewer = newAccount(Role.REVIEWER);
        String id = submit(member);

        json(reviewer).body(Map.of("decision", "APPROVE")).post("/admin/verifications/" + id + "/decision").then()
                .statusCode(409).body("code", equalTo("INVALID_TRANSITION"));
        workerMovesToReview(id);
        json(reviewer).body(Map.of("decision", "REJECT")).post("/admin/verifications/" + id + "/decision").then()
                .statusCode(400).body("code", equalTo("REASON_REQUIRED"));
        json(reviewer).body(Map.of("decision", "REJECT", "reason", "Photo is unreadable")).post("/admin/verifications/" + id + "/decision")
                .then().statusCode(200).body("status", equalTo("REJECTED")).body("rejectReason", equalTo("Photo is unreadable"));
        as(member).get("/me").then().body("identityVerified", equalTo(false));
        as(member).get("/verifications/me").then().body("[0].rejectReason", equalTo("Photo is unreadable"));

        submit(member);
        json(reviewer).body(Map.of("decision", "MAYBE")).post("/admin/verifications/" + id + "/decision").then().statusCode(400);
        json(reviewer).body(Map.of("decision", "APPROVE")).post("/admin/verifications/" + UUID.randomUUID() + "/decision").then().statusCode(404);
    }

    @Test
    void concurrentDecisionsOnlyApplyOnce() throws Exception {
        Account member = newMember();
        Account reviewer = newAccount(Role.REVIEWER);
        Account admin = newAccount(Role.ADMIN);
        String id = submit(member);
        workerMovesToReview(id);

        var pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        var approve = pool.submit(() -> json(reviewer).body(Map.of("decision", "APPROVE")).post("/admin/verifications/" + id + "/decision").statusCode());
        var reject = pool.submit(() -> json(admin).body(Map.of("decision", "REJECT", "reason", "no")).post("/admin/verifications/" + id + "/decision").statusCode());
        int a = approve.get();
        int b = reject.get();
        pool.shutdown();
        assertThat(java.util.List.of(a, b)).containsExactlyInAnyOrder(200, 409);
    }
}
