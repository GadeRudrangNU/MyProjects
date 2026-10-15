package com.trustpass.api.users;

import com.trustpass.api.audit.AuditService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.Role;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    private final UserRepository users;
    private final AuditService audit;

    UserService(UserRepository users, AuditService audit) {
        this.users = users;
        this.audit = audit;
    }

    public static String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    @Transactional(readOnly = true)
    public Optional<User> findByEmail(String email) {
        return users.findByEmail(normalizeEmail(email));
    }

    @Transactional(readOnly = true)
    public User get(UUID id) {
        return users.findById(id).orElseThrow(() -> ApiException.notFound("User"));
    }

    @Transactional
    public User create(String name, String email, String passwordHash, boolean emailVerified) {
        User user = new User();
        user.setName(name.trim());
        user.setEmail(normalizeEmail(email));
        user.setPasswordHash(passwordHash);
        user.setEmailVerified(emailVerified);
        return users.saveAndFlush(user);
    }

    @Transactional
    public User save(User user) {
        return users.save(user);
    }

    @Transactional
    public void applyIdentityResult(UUID userId, boolean verified, boolean ageOver21) {
        User user = get(userId);
        user.setIdentityVerified(verified);
        user.setAgeOver21(verified && ageOver21);
        users.save(user);
    }

    @Transactional
    public User changeRole(UUID id, Role role) {
        User user = get(id);
        Role previous = user.getRole();
        user.setRole(role);
        audit.record("USER_ROLE_CHANGED", "USER", id.toString(), Map.of("from", previous.name(), "to", role.name()));
        return users.save(user);
    }

    @Transactional
    public User unlock(UUID id) {
        User user = get(id);
        user.setFailedAttempts(0);
        user.setLockedUntil(null);
        audit.record("USER_UNLOCKED", "USER", id.toString(), Map.of());
        return users.save(user);
    }
}
