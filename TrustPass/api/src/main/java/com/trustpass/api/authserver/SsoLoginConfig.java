package com.trustpass.api.authserver;

import com.trustpass.api.auth.AuthService;
import com.trustpass.api.auth.MfaService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.users.User;
import com.trustpass.api.users.UserService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.LockedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.WebAuthenticationDetails;

@Configuration
class SsoLoginConfig {

    @Bean
    @Order(2)
    SecurityFilterChain ssoChain(HttpSecurity http) throws Exception {
        http.securityMatcher("/sso/**", "/oauth2/consent")
                .authorizeHttpRequests(a -> a.requestMatchers("/sso/login", "/sso/error").permitAll()
                        .anyRequest().authenticated())
                .formLogin(f -> f.loginPage("/sso/login").loginProcessingUrl("/sso/login")
                        .authenticationDetailsSource(SsoDetails::new)
                        .failureUrl("/sso/login?error"));
        return http.build();
    }

    @Bean
    AuthenticationProvider ssoAuthenticationProvider(AuthService auth, MfaService mfa, UserService users) {
        return new AuthenticationProvider() {
            @Override
            public Authentication authenticate(Authentication authentication) throws AuthenticationException {
                String email = UserService.normalizeEmail(authentication.getName());
                String password = String.valueOf(authentication.getCredentials());
                User user;
                try {
                    user = auth.authenticatePassword(email, password);
                } catch (ApiException e) {
                    if (e.status().value() == 423) {
                        throw new LockedException(e.getMessage());
                    }
                    throw new BadCredentialsException(e.getMessage());
                }
                if (user.isMfaEnabled()) {
                    String code = authentication.getDetails() instanceof SsoDetails d ? d.code() : null;
                    if (!mfa.verifyCode(user, code)) {
                        throw new BadCredentialsException("Invalid code");
                    }
                }
                return UsernamePasswordAuthenticationToken.authenticated(user.getId().toString(), null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name())));
            }

            @Override
            public boolean supports(Class<?> authentication) {
                return UsernamePasswordAuthenticationToken.class.isAssignableFrom(authentication);
            }
        };
    }

    static class SsoDetails extends WebAuthenticationDetails {

        private final String code;

        SsoDetails(HttpServletRequest request) {
            super(request);
            this.code = request.getParameter("code");
        }

        String code() {
            return code;
        }
    }
}
