package com.trustpass.common;

import java.time.Duration;

public final class Backoff {

    public static final int MAX_ATTEMPTS = 8;
    private static final long BASE_SECONDS = 5;
    private static final long CAP_SECONDS = 3600;

    private Backoff() {
    }

    public static Duration delayAfter(int attempts) {
        long seconds = BASE_SECONDS << Math.min(Math.max(attempts - 1, 0), 20);
        return Duration.ofSeconds(Math.min(seconds, CAP_SECONDS));
    }

    public static boolean exhausted(int attempts) {
        return attempts >= MAX_ATTEMPTS;
    }
}
