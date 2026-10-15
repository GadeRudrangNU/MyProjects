package com.trustpass.api.authserver;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import com.trustpass.api.shared.TrustPassProperties;
import com.trustpass.api.users.User;
import com.trustpass.api.users.UserService;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.oidc.OidcScopes;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.authorization.client.InMemoryRegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.config.annotation.web.configuration.OAuth2AuthorizationServerConfiguration;
import org.springframework.security.oauth2.server.authorization.config.annotation.web.configurers.OAuth2AuthorizationServerConfigurer;
import org.springframework.security.oauth2.core.oidc.OidcUserInfo;
import org.springframework.security.oauth2.server.authorization.oidc.authentication.OidcUserInfoAuthenticationContext;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.LoginUrlAuthenticationEntryPoint;
import org.springframework.security.web.util.matcher.MediaTypeRequestMatcher;

@Configuration
class AuthorizationServerConfig {

    static final String AGE_SCOPE = "verified_age_over_21";
    static final String CLIENT_ID = "partner-demo";

    @Bean
    @Order(1)
    SecurityFilterChain authorizationServerChain(HttpSecurity http, UserService users) throws Exception {
        OAuth2AuthorizationServerConfigurer configurer = OAuth2AuthorizationServerConfigurer.authorizationServer();
        MediaTypeRequestMatcher browserRequests = new MediaTypeRequestMatcher(MediaType.TEXT_HTML);
        browserRequests.setIgnoredMediaTypes(Set.of(MediaType.ALL));
        http.securityMatcher(configurer.getEndpointsMatcher())
                .with(configurer, server -> server
                        .authorizationEndpoint(a -> a.consentPage("/oauth2/consent"))
                        .oidc(oidc -> oidc.userInfoEndpoint(u -> u.userInfoMapper(userInfoMapper(users)))))
                .authorizeHttpRequests(a -> a.anyRequest().authenticated())
                .cors(Customizer.withDefaults())
                .exceptionHandling(e -> e.defaultAuthenticationEntryPointFor(
                        new LoginUrlAuthenticationEntryPoint("/sso/login"), browserRequests))
                .oauth2ResourceServer(rs -> rs.jwt(Customizer.withDefaults()));
        return http.build();
    }

    @Bean
    RegisteredClientRepository registeredClientRepository(
            @Value("${trustpass.partner.redirect-uri:http://localhost:5174/callback}") String redirectUri) {
        RegisteredClient partner = RegisteredClient.withId(UUID.randomUUID().toString())
                .clientId(CLIENT_ID)
                .clientName("Partner Demo")
                .clientAuthenticationMethod(ClientAuthenticationMethod.NONE)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri(redirectUri)
                .scope(OidcScopes.OPENID)
                .scope(OidcScopes.PROFILE)
                .scope(OidcScopes.EMAIL)
                .scope(AGE_SCOPE)
                .clientSettings(ClientSettings.builder().requireProofKey(true).requireAuthorizationConsent(true).build())
                .tokenSettings(TokenSettings.builder().accessTokenTimeToLive(Duration.ofMinutes(10)).build())
                .build();
        return new InMemoryRegisteredClientRepository(partner);
    }

    @Bean
    AuthorizationServerSettings authorizationServerSettings(TrustPassProperties props) {
        return AuthorizationServerSettings.builder().issuer(props.security().issuer()).build();
    }

    @Bean
    JWKSource<SecurityContext> jwkSource() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        RSAKey key = new RSAKey.Builder((RSAPublicKey) pair.getPublic())
                .privateKey((RSAPrivateKey) pair.getPrivate())
                .keyID(UUID.randomUUID().toString())
                .build();
        return new ImmutableJWKSet<>(new JWKSet(key));
    }

    @Bean
    JwtDecoder jwtDecoder(JWKSource<SecurityContext> jwkSource) {
        return OAuth2AuthorizationServerConfiguration.jwtDecoder(jwkSource);
    }

    @Bean
    OAuth2TokenCustomizer<JwtEncodingContext> ageClaimCustomizer(UserService users) {
        return context -> {
            if (context.getAuthorizedScopes().contains(AGE_SCOPE)) {
                context.getClaims().claim(AGE_SCOPE, ageClaim(users.get(UUID.fromString(context.getPrincipal().getName()))));
            }
        };
    }

    private static java.util.function.Function<OidcUserInfoAuthenticationContext, OidcUserInfo> userInfoMapper(UserService users) {
        return context -> {
            Set<String> scopes = context.getAccessToken().getScopes();
            User user = users.get(UUID.fromString(context.getAuthorization().getPrincipalName()));
            Map<String, Object> claims = new HashMap<>();
            claims.put("sub", user.getId().toString());
            if (scopes.contains(OidcScopes.PROFILE)) {
                claims.put("name", user.getName());
            }
            if (scopes.contains(OidcScopes.EMAIL)) {
                claims.put("email", user.getEmail());
                claims.put("email_verified", user.isEmailVerified());
            }
            if (scopes.contains(AGE_SCOPE)) {
                claims.put(AGE_SCOPE, ageClaim(user));
            }
            return new OidcUserInfo(claims);
        };
    }

    private static boolean ageClaim(User user) {
        return user.isIdentityVerified() && user.isAgeOver21();
    }
}
