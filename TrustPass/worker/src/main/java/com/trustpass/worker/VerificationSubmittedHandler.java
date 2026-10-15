package com.trustpass.worker;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.trustpass.common.FieldCrypto;
import com.trustpass.common.JobType;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class VerificationSubmittedHandler implements JobHandler {

    private final JdbcClient jdbc;
    private final FieldCrypto crypto;
    private final ObjectMapper mapper;
    private final Clock clock;

    VerificationSubmittedHandler(JdbcClient jdbc, FieldCrypto crypto, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.crypto = crypto;
        this.mapper = mapper;
        this.clock = Clock.systemUTC();
    }

    @Override
    public Set<JobType> types() {
        return Set.of(JobType.VERIFICATION_SUBMITTED);
    }

    @Override
    public void handle(Job job) throws Exception {
        UUID id = UUID.fromString(job.text("verificationId"));
        var row = jdbc.sql("""
                        select v.user_id, v.full_name, v.dob_enc, v.id_expiry, v.file_sha256, v.id_number_fp, v.status,
                               u.name as account_name
                        from verifications v join users u on u.id = v.user_id where v.id = :id
                        """)
                .param("id", id)
                .query((rs, n) -> new Object[]{rs.getObject("user_id", UUID.class), rs.getString("full_name"),
                        rs.getString("dob_enc"), rs.getDate("id_expiry").toLocalDate(), rs.getString("file_sha256"),
                        rs.getString("id_number_fp"), rs.getString("status"), rs.getString("account_name")})
                .optional()
                .orElseThrow(() -> new IllegalStateException("verification " + id + " not found"));
        if (!"PENDING".equals(row[6])) {
            return;
        }
        UUID userId = (UUID) row[0];
        long duplicates = jdbc.sql("""
                        select count(*) from verifications
                        where user_id <> :user and (file_sha256 = :hash or id_number_fp = :fp)
                        """)
                .param("user", userId).param("hash", row[4]).param("fp", row[5])
                .query(Long.class).single();
        List<String> flags = VerificationChecks.evaluate((String) row[7], (String) row[1],
                LocalDate.parse(crypto.decrypt((String) row[2])), (LocalDate) row[3],
                LocalDate.now(clock), duplicates > 0);
        jdbc.sql("""
                        update verifications set status = 'IN_REVIEW', flags = cast(:flags as jsonb), updated_at = now()
                        where id = :id and status = 'PENDING'
                        """)
                .param("flags", mapper.writeValueAsString(flags)).param("id", id).update();
    }
}
