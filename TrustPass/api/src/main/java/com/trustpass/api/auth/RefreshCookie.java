package com.trustpass.api.auth;

import com.trustpass.api.shared.TrustPassProperties;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

@Component
class RefreshCookie {

    static final String NAME = "tp_refresh";
    private final TrustPassProperties props;

    RefreshCookie(TrustPassProperties props) {
        this.props = props;
    }

    String issue(String token) {
        return build(token, props.security().refreshTtl().toSeconds()).toString();
    }

    String clear() {
        return build("", 0).toString();
    }

    private ResponseCookie build(String value, long maxAgeSeconds) {
        return ResponseCookie.from(NAME, value)
                .httpOnly(true)
                .secure(props.security().cookieSecure())
                .sameSite("Lax")
                .path("/auth")
                .maxAge(maxAgeSeconds)
                .build();
    }
}
