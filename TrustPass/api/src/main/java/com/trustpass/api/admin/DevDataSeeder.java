package com.trustpass.api.admin;

import com.trustpass.api.auth.PasswordHasher;
import com.trustpass.api.shared.Role;
import com.trustpass.api.users.UserService;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty("trustpass.seed.enabled")
class DevDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevDataSeeder.class);
    static final String PASSWORD = "TrustPass#2025";

    private final UserService users;
    private final PasswordHasher hasher;
    private final JdbcClient jdbc;

    DevDataSeeder(UserService users, PasswordHasher hasher, JdbcClient jdbc) {
        this.users = users;
        this.hasher = hasher;
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        seedUser("Ada Admin", "admin@trustpass.dev", Role.ADMIN);
        seedUser("Rey Reviewer", "reviewer@trustpass.dev", Role.REVIEWER);
        seedUser("Sam Support", "support@trustpass.dev", Role.SUPPORT);
        seedUser("Mia Member", "member@trustpass.dev", Role.MEMBER);
        seedLocations();
    }

    private void seedUser(String name, String email, Role role) {
        if (users.findByEmail(email).isPresent()) {
            return;
        }
        var user = users.create(name, email, hasher.hash(PASSWORD), true);
        if (role != Role.MEMBER) {
            users.changeRole(user.getId(), role);
        }
        log.info("seeded {} account {}", role, email);
    }

    private void seedLocations() {
        long existing = jdbc.sql("select count(*) from locations").query(Long.class).single();
        if (existing > 0) {
            return;
        }
        String[][] sites = {{"Downtown Hub", "100 Main Street"}, {"Airport Lounge", "Terminal 2, Gate Level"}};
        Instant base = LocalDate.now(ZoneOffset.UTC).plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC);
        for (String[] site : sites) {
            UUID locationId = UUID.randomUUID();
            jdbc.sql("insert into locations (id, name, address) values (:id, :name, :address)")
                    .param("id", locationId).param("name", site[0]).param("address", site[1]).update();
            for (int day = 0; day < 5; day++) {
                for (int hour = 9; hour < 13; hour++) {
                    Instant start = base.plus(day, ChronoUnit.DAYS).plus(hour, ChronoUnit.HOURS);
                    int capacity = day == 0 && hour == 9 ? 1 : 4;
                    jdbc.sql("insert into slots (id, location_id, starts_at, ends_at, capacity) values (:id, :loc, :s, :e, :cap)")
                            .param("id", UUID.randomUUID()).param("loc", locationId)
                            .param("s", java.sql.Timestamp.from(start))
                            .param("e", java.sql.Timestamp.from(start.plus(1, ChronoUnit.HOURS)))
                            .param("cap", capacity).update();
                }
            }
        }
        log.info("seeded locations and slots");
    }
}
