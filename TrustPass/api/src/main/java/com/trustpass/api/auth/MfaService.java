package com.trustpass.api.auth;

import com.trustpass.api.audit.AuditService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.Hashing;
import com.trustpass.api.users.User;
import com.trustpass.api.users.UserService;
import dev.samstevens.totp.code.CodeVerifier;
import dev.samstevens.totp.code.DefaultCodeGenerator;
import dev.samstevens.totp.code.DefaultCodeVerifier;
import dev.samstevens.totp.exceptions.QrGenerationException;
import dev.samstevens.totp.qr.QrData;
import dev.samstevens.totp.qr.ZxingPngQrGenerator;
import dev.samstevens.totp.secret.DefaultSecretGenerator;
import dev.samstevens.totp.time.SystemTimeProvider;
import dev.samstevens.totp.util.Utils;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MfaService {

    private static final int BACKUP_CODES = 8;

    private final UserService users;
    private final PasswordHasher hasher;
    private final JdbcClient jdbc;
    private final AuditService audit;
    private final DefaultSecretGenerator secrets = new DefaultSecretGenerator(32);
    private final ZxingPngQrGenerator qr = new ZxingPngQrGenerator();
    private final CodeVerifier verifier;

    MfaService(UserService users, PasswordHasher hasher, JdbcClient jdbc, AuditService audit) {
        this.users = users;
        this.hasher = hasher;
        this.jdbc = jdbc;
        this.audit = audit;
        DefaultCodeVerifier codeVerifier = new DefaultCodeVerifier(new DefaultCodeGenerator(), new SystemTimeProvider());
        codeVerifier.setAllowedTimePeriodDiscrepancy(1);
        this.verifier = codeVerifier;
    }

    public record Setup(String secret, String otpauthUri, String qrCode) {
    }

    @Transactional
    Setup setup(UUID userId) {
        User user = users.get(userId);
        if (user.isMfaEnabled()) {
            throw ApiException.conflict("MFA_ALREADY_ENABLED", "Two-factor authentication is already enabled");
        }
        String secret = secrets.generate();
        user.setMfaSecret(secret);
        users.save(user);
        QrData data = new QrData.Builder().label(user.getEmail()).secret(secret).issuer("TrustPass").build();
        try {
            String image = Utils.getDataUriForImage(qr.generate(data), qr.getImageMimeType());
            return new Setup(secret, data.getUri(), image);
        } catch (QrGenerationException e) {
            throw new IllegalStateException("could not render QR code", e);
        }
    }

    @Transactional
    List<String> enable(UUID userId, String code) {
        User user = users.get(userId);
        if (user.isMfaEnabled()) {
            throw ApiException.conflict("MFA_ALREADY_ENABLED", "Two-factor authentication is already enabled");
        }
        if (user.getMfaSecret() == null || !verifier.isValidCode(user.getMfaSecret(), code)) {
            throw ApiException.badRequest("INVALID_CODE", "The code is not valid");
        }
        user.setMfaEnabled(true);
        users.save(user);
        List<String> codes = new ArrayList<>();
        jdbc.sql("delete from mfa_backup_codes where user_id = :u").param("u", userId).update();
        for (int i = 0; i < BACKUP_CODES; i++) {
            String plain = Hashing.randomToken(6).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "x");
            String formatted = plain.substring(0, 4) + "-" + plain.substring(4, 8);
            codes.add(formatted);
            jdbc.sql("insert into mfa_backup_codes (id, user_id, code_hash) values (:id, :u, :h)")
                    .param("id", UUID.randomUUID()).param("u", userId).param("h", Hashing.sha256Hex(normalize(formatted)))
                    .update();
        }
        audit.record("MFA_ENABLED", "USER", userId.toString(), Map.of());
        return codes;
    }

    @Transactional
    void disable(UUID userId, String password, String code) {
        User user = users.get(userId);
        if (!user.isMfaEnabled()) {
            throw ApiException.conflict("MFA_NOT_ENABLED", "Two-factor authentication is not enabled");
        }
        if (!hasher.matches(password, user.getPasswordHash()) || !verifyCode(user, code)) {
            throw ApiException.badRequest("INVALID_CREDENTIALS", "Password or code is not valid");
        }
        user.setMfaEnabled(false);
        user.setMfaSecret(null);
        users.save(user);
        jdbc.sql("delete from mfa_backup_codes where user_id = :u").param("u", userId).update();
        audit.record("MFA_DISABLED", "USER", userId.toString(), Map.of());
    }

    @Transactional
    public boolean verifyCode(User user, String code) {
        if (code == null || code.isBlank() || user.getMfaSecret() == null) {
            return false;
        }
        String trimmed = code.trim();
        if (trimmed.matches("\\d{6}")) {
            return verifier.isValidCode(user.getMfaSecret(), trimmed);
        }
        int used = jdbc.sql("update mfa_backup_codes set used_at = now() where user_id = :u and code_hash = :h and used_at is null")
                .param("u", user.getId()).param("h", Hashing.sha256Hex(normalize(trimmed))).update();
        return used > 0;
    }

    private static String normalize(String code) {
        return code.toLowerCase(Locale.ROOT).replace("-", "").replace(" ", "");
    }
}
