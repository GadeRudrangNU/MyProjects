package com.trustpass.worker;

import java.text.Normalizer;
import java.time.LocalDate;
import java.time.Period;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class VerificationChecks {

    public static final int MINIMUM_AGE = 18;

    private VerificationChecks() {
    }

    public static List<String> evaluate(String accountName, String documentName, LocalDate dateOfBirth,
                                        LocalDate expiry, LocalDate today, boolean duplicateDocument) {
        List<String> flags = new ArrayList<>();
        if (expiry.isBefore(today)) {
            flags.add("EXPIRED_DOCUMENT");
        }
        if (!namesMatch(accountName, documentName)) {
            flags.add("NAME_MISMATCH");
        }
        if (Period.between(dateOfBirth, today).getYears() < MINIMUM_AGE) {
            flags.add("UNDERAGE");
        }
        if (duplicateDocument) {
            flags.add("DUPLICATE_DOCUMENT");
        }
        return flags;
    }

    static boolean namesMatch(String a, String b) {
        Set<String> first = tokens(a);
        Set<String> second = tokens(b);
        if (first.isEmpty() || second.isEmpty()) {
            return false;
        }
        Set<String> smaller = first.size() <= second.size() ? first : second;
        Set<String> larger = smaller == first ? second : first;
        return larger.containsAll(smaller);
    }

    private static Set<String> tokens(String name) {
        String plain = Normalizer.normalize(name == null ? "" : name, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).replaceAll("[^a-z ]", " ");
        return new HashSet<>(Arrays.stream(plain.trim().split("\\s+")).filter(t -> !t.isBlank()).toList());
    }
}
