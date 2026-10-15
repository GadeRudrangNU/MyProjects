package com.trustpass.common;

public final class Masking {

    private Masking() {
    }

    public static String keepLast(String value, int visible) {
        if (value == null || value.isEmpty()) {
            return value;
        }
        if (value.length() <= visible) {
            return "*".repeat(value.length());
        }
        return "*".repeat(value.length() - visible) + value.substring(value.length() - visible);
    }

    public static String email(String email) {
        if (email == null) {
            return null;
        }
        int at = email.indexOf('@');
        if (at <= 1) {
            return "*" + email.substring(Math.max(at, 0));
        }
        return email.charAt(0) + "*".repeat(at - 1) + email.substring(at);
    }
}
