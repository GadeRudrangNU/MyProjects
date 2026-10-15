package com.trustpass.api.auth;

import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.Hashing;
import com.trustpass.api.shared.TrustPassProperties;
import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.BucketConfiguration;
import io.github.bucket4j.ConsumptionProbe;
import io.github.bucket4j.distributed.proxy.ProxyManager;
import io.github.bucket4j.postgresql.Bucket4jPostgreSQL;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.HexFormat;
import javax.sql.DataSource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class RateLimiter {

    private final ProxyManager<Long> buckets;
    private final boolean enabled;

    RateLimiter(DataSource dataSource, TrustPassProperties props) {
        this.enabled = props.rateLimit().enabled();
        this.buckets = Bucket4jPostgreSQL.advisoryLockBasedBuilder(dataSource)
                .table("rate_limit_buckets").idColumn("id").stateColumn("state").build();
    }

    public void check(String key, int limit, Duration window) {
        if (!enabled) {
            return;
        }
        BucketConfiguration config = BucketConfiguration.builder()
                .addLimit(Bandwidth.builder().capacity(limit).refillIntervally(limit, window).build())
                .build();
        ConsumptionProbe probe = buckets.getProxy(toKey(key), () -> config).tryConsumeAndReturnRemaining(1);
        if (!probe.isConsumed()) {
            long seconds = Math.max(1, Duration.ofNanos(probe.getNanosToWaitForRefill()).toSeconds());
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED",
                    "Too many attempts, try again in " + seconds + " seconds");
        }
    }

    private static long toKey(String key) {
        return ByteBuffer.wrap(HexFormat.of().parseHex(Hashing.sha256Hex(key).substring(0, 16))).getLong();
    }
}
