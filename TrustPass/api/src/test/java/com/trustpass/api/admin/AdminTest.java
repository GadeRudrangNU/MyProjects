package com.trustpass.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;

import com.trustpass.api.IntegrationTest;
import com.trustpass.api.shared.Role;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;

class AdminTest extends IntegrationTest {

    @Test
    void supportCanSearchUsersButOnlyAdminsChangeRoles() {
        Account support = newAccount(Role.SUPPORT);
        Account admin = newAccount(Role.ADMIN);
        Account member = newMember();

        as(support).get("/admin/users?q=" + member.email()).then().statusCode(200)
                .body("items", hasSize(1)).body("items[0].id", equalTo(member.id().toString()))
                .body("total", equalTo(1));
        as(support).get("/admin/users?size=1&page=0").then().statusCode(200).body("items", hasSize(1));

        json(support).body(Map.of("role", "REVIEWER")).patch("/admin/users/" + member.id() + "/role").then().statusCode(403);
        json(admin).body(Map.of("role", "REVIEWER")).patch("/admin/users/" + member.id() + "/role").then().statusCode(200)
                .body("role", equalTo("REVIEWER"));
        json(admin).body(Map.of("role", "NOPE")).patch("/admin/users/" + member.id() + "/role").then().statusCode(400);
        assertThat(jdbc.queryForObject("select count(*) from audit_log where action = 'USER_ROLE_CHANGED' and target_id = ?", Long.class, member.id().toString())).isEqualTo(1);
    }

    @Test
    void supportCanRevokeAllSessionsOfAUser() {
        Account support = newAccount(Role.SUPPORT);
        Account member = newMember();
        json(support).post("/admin/users/" + member.id() + "/sessions/revoke").then().statusCode(204);
        as(member).get("/me").then().statusCode(401);
    }

    @Test
    void auditLogIsReadableByAdminsAndFilterable() {
        Account admin = newAccount(Role.ADMIN);
        as(admin).get("/admin/audit-log?size=5").then().statusCode(200)
                .body("items.size()", greaterThanOrEqualTo(1)).body("items[0].action", notNullValue())
                .body("total", greaterThanOrEqualTo(1));
        as(admin).get("/admin/audit-log?action=LOGIN").then().statusCode(200).body("items.action", hasItem("LOGIN"));
        as(newAccount(Role.SUPPORT)).get("/admin/audit-log").then().statusCode(403);
    }

    @Test
    void auditLogCannotBeChangedOrDeleted() {
        newMember();
        assertThatThrownBy(() -> jdbc.update("update audit_log set action = 'TAMPERED'")).isInstanceOf(DataAccessException.class)
                .hasMessageContaining("append-only");
        assertThatThrownBy(() -> jdbc.update("delete from audit_log")).isInstanceOf(DataAccessException.class)
                .hasMessageContaining("append-only");
        assertThatThrownBy(() -> jdbc.execute("truncate audit_log")).isInstanceOf(DataAccessException.class)
                .hasMessageContaining("append-only");
    }

    @Test
    void deadJobsCanBeListedAndRetried() {
        Account admin = newAccount(Role.ADMIN);
        Long id = jdbc.queryForObject("""
                insert into outbox_jobs (type, payload, status, attempts, last_error, trace_id)
                values ('BOOKING_CONFIRMED', '{}', 'DEAD', 8, 'smtp down', 'trace-123') returning id
                """, Long.class);

        as(admin).get("/admin/jobs?status=DEAD").then().statusCode(200).body("items.id", hasItem(id.intValue()))
                .body("items.find { it.id == " + id + " }.traceId", equalTo("trace-123"))
                .body("items.find { it.id == " + id + " }.lastError", equalTo("smtp down"));

        Account support = newAccount(Role.SUPPORT);
        json(support).post("/admin/jobs/" + id + "/retry").then().statusCode(204);
        assertThat(jdbc.queryForObject("select status from outbox_jobs where id = ?", String.class, id)).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("select attempts from outbox_jobs where id = ?", Integer.class, id)).isZero();
        json(admin).post("/admin/jobs/" + id + "/retry").then().statusCode(409).body("code", equalTo("JOB_NOT_DEAD"));
        assertThat(jdbc.queryForObject("select count(*) from audit_log where action = 'JOB_RETRIED' and target_id = ?", Long.class, String.valueOf(id))).isEqualTo(1);
        jdbc.update("delete from outbox_jobs where id = ?", id);
    }

    @Test
    void metricsSummaryCoversTheDashboardNumbers() {
        newMember();
        Account admin = newAccount(Role.ADMIN);
        as(admin).get("/admin/metrics/summary").then().statusCode(200)
                .body("totalUsers", greaterThanOrEqualTo(2))
                .body("signupsPerDay", hasSize(14))
                .body("failedLoginsPerDay", hasSize(14))
                .body("verificationPassRate", notNullValue())
                .body("bookingsPerLocation", notNullValue())
                .body("jobsByStatus", notNullValue());
        as(newAccount(Role.SUPPORT)).get("/admin/metrics/summary").then().statusCode(200);
    }
}
