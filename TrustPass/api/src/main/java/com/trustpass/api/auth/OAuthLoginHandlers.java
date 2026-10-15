package com.trustpass.api.auth;

import com.trustpass.api.shared.TrustPassProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.client.userinfo.DefaultOAuth2UserService;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserService;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
class OAuthLoginHandlers {

    private final OAuthAccountService accounts;
    private final RefreshCookie cookie;
    private final TrustPassProperties props;

    OAuthLoginHandlers(OAuthAccountService accounts, RefreshCookie cookie, TrustPassProperties props) {
        this.accounts = accounts;
        this.cookie = cookie;
        this.props = props;
    }

    AuthenticationSuccessHandler success() {
        return (request, response, authentication) -> {
            String target;
            try {
                target = route(authentication, response);
            } finally {
                endTemporarySession(request);
            }
            response.sendRedirect(target);
        };
    }

    AuthenticationFailureHandler failure() {
        return (HttpServletRequest request, HttpServletResponse response, AuthenticationException exception) -> {
            endTemporarySession(request);
            response.sendRedirect(props.frontendUrl() + "/login?error=oauth_failed");
        };
    }

    OAuth2UserService<OAuth2UserRequest, OAuth2User> githubAwareUserService() {
        DefaultOAuth2UserService delegate = new DefaultOAuth2UserService();
        RestClient http = RestClient.create();
        return request -> {
            OAuth2User user = delegate.loadUser(request);
            if (!"github".equals(request.getClientRegistration().getRegistrationId())) {
                return user;
            }
            List<Map<String, Object>> emails = http.get().uri("https://api.github.com/user/emails")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + request.getAccessToken().getTokenValue())
                    .retrieve().body(new ParameterizedTypeReference<>() {
                    });
            Map<String, Object> attributes = new HashMap<>(user.getAttributes());
            attributes.put("email_verified", false);
            for (Map<String, Object> entry : emails == null ? List.<Map<String, Object>>of() : emails) {
                if (Boolean.TRUE.equals(entry.get("primary")) && Boolean.TRUE.equals(entry.get("verified"))) {
                    attributes.put("email", entry.get("email"));
                    attributes.put("email_verified", true);
                }
            }
            return new DefaultOAuth2User(new ArrayList<>(user.getAuthorities()), attributes, "id");
        };
    }

    private String route(Authentication authentication, HttpServletResponse response) throws IOException {
        OAuth2AuthenticationToken token = (OAuth2AuthenticationToken) authentication;
        OAuth2User principal = token.getPrincipal();
        String provider = token.getAuthorizedClientRegistrationId();
        String subject = "github".equals(provider) ? String.valueOf(principal.getAttribute("id")) : principal.getName();
        boolean verified = Boolean.TRUE.equals(principal.getAttribute("email_verified"));
        OAuthAccountService.Resolution resolution = accounts.resolve(new OAuthAccountService.Profile(
                provider, subject, principal.getAttribute("email"), verified, principal.getAttribute("name")));
        String base = props.frontendUrl();
        if (resolution.error() != null) {
            return base + "/login?error=" + resolution.error();
        }
        if (resolution.linkToken() != null) {
            return base + "/oauth/link?token=" + encode(resolution.linkToken()) + "&provider=" + encode(provider);
        }
        AuthService.LoginOutcome outcome = accounts.outcomeFor(resolution.user());
        if (outcome.authenticated() == null) {
            return base + "/login/mfa?token=" + encode(outcome.mfaToken());
        }
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.issue(outcome.authenticated().refreshToken()));
        return base + "/oauth/callback";
    }

    private static void endTemporarySession(HttpServletRequest request) {
        SecurityContextHolder.clearContext();
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
