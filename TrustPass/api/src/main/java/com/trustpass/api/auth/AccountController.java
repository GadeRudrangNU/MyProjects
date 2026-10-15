package com.trustpass.api.auth;

import com.trustpass.api.audit.AuditService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
class AccountController {

    private final SessionService sessions;
    private final MfaService mfa;
    private final AuditService audit;

    AccountController(SessionService sessions, MfaService mfa, AuditService audit) {
        this.sessions = sessions;
        this.mfa = mfa;
        this.audit = audit;
    }

    @GetMapping("/me/sessions")
    List<SessionService.SessionView> listSessions() {
        CurrentUser me = CurrentUser.require();
        return sessions.list(me.id(), me.sessionId());
    }

    @DeleteMapping("/me/sessions/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void revokeSession(@PathVariable UUID id) {
        CurrentUser me = CurrentUser.require();
        if (!sessions.revoke(me.id(), id)) {
            throw ApiException.notFound("Session");
        }
        audit.record("SESSION_REVOKED", "SESSION", id.toString(), Map.of());
    }

    @DeleteMapping("/me/sessions")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void revokeAllSessions() {
        CurrentUser me = CurrentUser.require();
        int count = sessions.revokeAll(me.id());
        audit.record("SESSIONS_REVOKED_ALL", "USER", me.id().toString(), Map.of("count", count));
    }

    @PostMapping("/me/mfa/setup")
    MfaService.Setup setupMfa() {
        return mfa.setup(CurrentUser.require().id());
    }

    @PostMapping("/me/mfa/enable")
    BackupCodes enableMfa(@Valid @RequestBody CodeRequest body) {
        return new BackupCodes(mfa.enable(CurrentUser.require().id(), body.code()));
    }

    @PostMapping("/me/mfa/disable")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void disableMfa(@Valid @RequestBody DisableRequest body) {
        mfa.disable(CurrentUser.require().id(), body.password(), body.code());
    }

    @PostMapping("/admin/users/{id}/sessions/revoke")
    @PreAuthorize("hasAnyRole('ADMIN','SUPPORT')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void revokeUserSessions(@PathVariable UUID id) {
        int count = sessions.revokeAll(id);
        audit.record("SESSIONS_REVOKED_BY_STAFF", "USER", id.toString(), Map.of("count", count));
    }

    record CodeRequest(@NotBlank @Size(max = 32) String code) {
    }

    record DisableRequest(@NotBlank @Size(max = 128) String password, @NotBlank @Size(max = 32) String code) {
    }

    record BackupCodes(List<String> codes) {
    }
}
