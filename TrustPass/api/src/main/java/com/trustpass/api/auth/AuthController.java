package com.trustpass.api.auth;

import com.trustpass.api.auth.AuthDtos.LinkRequest;
import com.trustpass.api.auth.AuthDtos.LoginRequest;
import com.trustpass.api.auth.AuthDtos.LoginResponse;
import com.trustpass.api.auth.AuthDtos.MessageResponse;
import com.trustpass.api.auth.AuthDtos.MfaVerifyRequest;
import com.trustpass.api.auth.AuthDtos.ProviderView;
import com.trustpass.api.auth.AuthDtos.ResendRequest;
import com.trustpass.api.auth.AuthDtos.SignupRequest;
import com.trustpass.api.auth.AuthDtos.TokenResponse;
import com.trustpass.api.users.UserView;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
class AuthController {

    private final AuthService auth;
    private final EmailVerificationService emailVerification;
    private final OAuthAccountService oauth;
    private final RefreshCookie cookie;
    private final ObjectProvider<InMemoryClientRegistrationRepository> registrations;

    AuthController(AuthService auth, EmailVerificationService emailVerification, OAuthAccountService oauth,
                   RefreshCookie cookie, ObjectProvider<InMemoryClientRegistrationRepository> registrations) {
        this.auth = auth;
        this.emailVerification = emailVerification;
        this.oauth = oauth;
        this.cookie = cookie;
        this.registrations = registrations;
    }

    @PostMapping("/signup")
    ResponseEntity<MessageResponse> signup(@Valid @RequestBody SignupRequest body) {
        auth.signup(body.name(), body.email(), body.password());
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(new MessageResponse("If the address can be used, a verification email is on its way."));
    }

    @GetMapping("/verify-email")
    MessageResponse verifyEmail(@RequestParam String token) {
        emailVerification.verify(token);
        return new MessageResponse("Email verified");
    }

    @PostMapping("/resend-verification")
    ResponseEntity<MessageResponse> resendVerification(@Valid @RequestBody ResendRequest body) {
        emailVerification.resend(body.email());
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(new MessageResponse("If the account needs verification, a new email is on its way."));
    }

    @PostMapping("/login")
    ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest body) {
        return respond(auth.login(body.email(), body.password()));
    }

    @PostMapping("/mfa/verify")
    ResponseEntity<LoginResponse> verifyMfa(@Valid @RequestBody MfaVerifyRequest body) {
        return respond(new AuthService.LoginOutcome(auth.mfaVerify(body.mfaToken(), body.code()), null));
    }

    @PostMapping("/refresh")
    ResponseEntity<TokenResponse> refreshSession(@CookieValue(name = RefreshCookie.NAME, required = false) String refreshToken) {
        AuthService.Authenticated session = auth.refresh(refreshToken);
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie.issue(session.refreshToken()))
                .body(new TokenResponse(session.accessToken(), session.expiresIn()));
    }

    @PostMapping("/logout")
    ResponseEntity<Void> logout(@CookieValue(name = RefreshCookie.NAME, required = false) String refreshToken) {
        auth.logout(refreshToken);
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie.clear()).build();
    }

    @GetMapping("/providers")
    List<ProviderView> listProviders() {
        InMemoryClientRegistrationRepository repo = registrations.getIfAvailable();
        if (repo == null) {
            return List.of();
        }
        List<ProviderView> out = new java.util.ArrayList<>();
        for (ClientRegistration r : repo) {
            out.add(new ProviderView(r.getRegistrationId(), r.getClientName()));
        }
        return out;
    }

    @PostMapping("/oauth/link")
    ResponseEntity<LoginResponse> confirmOAuthLink(@Valid @RequestBody LinkRequest body) {
        return respond(oauth.confirmLink(body.linkToken(), body.password()));
    }

    private ResponseEntity<LoginResponse> respond(AuthService.LoginOutcome outcome) {
        if (outcome.authenticated() == null) {
            return ResponseEntity.ok(new LoginResponse("MFA_REQUIRED", null, null, outcome.mfaToken(), null));
        }
        AuthService.Authenticated session = outcome.authenticated();
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie.issue(session.refreshToken()))
                .body(new LoginResponse("OK", session.accessToken(), session.expiresIn(), null,
                        UserView.of(session.user())));
    }
}
