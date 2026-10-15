package com.trustpass.common;

import java.util.Set;

public enum VerificationStatus {
    PENDING,
    IN_REVIEW,
    VERIFIED,
    REJECTED;

    public Set<VerificationStatus> next() {
        return switch (this) {
            case PENDING -> Set.of(IN_REVIEW);
            case IN_REVIEW -> Set.of(VERIFIED, REJECTED);
            case VERIFIED, REJECTED -> Set.of();
        };
    }

    public boolean canMoveTo(VerificationStatus target) {
        return next().contains(target);
    }
}
