package com.trustpass.api.auth;

import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
public class PasswordHasher {

    private final Argon2PasswordEncoder encoder = Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    private final String decoy = encoder.encode("decoy-password-for-timing");

    public String hash(String password) {
        return encoder.encode(password);
    }

    public boolean matches(String password, String hash) {
        return hash != null && encoder.matches(password, hash);
    }

    public void spendTime(String password) {
        encoder.matches(password, decoy);
    }
}
