package com.trustpass.api.shared;

import java.sql.Timestamp;
import java.time.Instant;

public final class Sql {

    private Sql() {
    }

    public static Timestamp ts(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }
}
