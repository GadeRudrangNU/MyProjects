package com.trustpass.api.auth;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.TrustPassProperties;
import com.trustpass.api.users.User;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Service;

@Service
public class TokenService {

    static final String ISSUER = "trustpass-api";
    static final String PURPOSE_ACCESS = "access";
    static final String PURPOSE_MFA = "mfa";
    static final String PURPOSE_LINK = "link";

    private final TrustPassProperties props;
    private final Clock clock;
    private final SecretKey key;
    private final JwtEncoder encoder;
    private final NimbusJwtDecoder decoder;

    TokenService(TrustPassProperties props, Clock clock) {
        this.props = props;
        this.clock = clock;
        this.key = new SecretKeySpec(props.security().jwtSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        this.encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        this.decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
    }

    public Duration accessTtl() {
        return props.security().accessTtl();
    }

    String access(User user, UUID sessionId) {
        return encode(JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(user.getId().toString())
                .issuedAt(clock.instant())
                .expiresAt(clock.instant().plus(accessTtl()))
                .claim("purpose", PURPOSE_ACCESS)
                .claim("sid", sessionId.toString())
                .claim("role", user.getRole().name())
                .claim("email", user.getEmail()));
    }

    String mfaChallenge(UUID userId) {
        return encode(JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(userId.toString())
                .issuedAt(clock.instant())
                .expiresAt(clock.instant().plus(Duration.ofMinutes(5)))
                .claim("purpose", PURPOSE_MFA));
    }

    String linkChallenge(UUID userId, String provider, String subject, String email) {
        return encode(JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(userId.toString())
                .issuedAt(clock.instant())
                .expiresAt(clock.instant().plus(Duration.ofMinutes(10)))
                .claim("purpose", PURPOSE_LINK)
                .claim("provider", provider)
                .claim("external", subject)
                .claim("email", email));
    }

    Jwt parse(String token, String purpose) {
        try {
            Jwt jwt = decoder.decode(token);
            Instant expires = jwt.getExpiresAt();
            if (!ISSUER.equals(jwt.getClaimAsString("iss"))
                    || !purpose.equals(jwt.getClaimAsString("purpose"))
                    || expires == null || expires.isBefore(clock.instant())) {
                throw ApiException.unauthorized("Invalid or expired token");
            }
            return jwt;
        } catch (JwtException e) {
            throw ApiException.unauthorized("Invalid or expired token");
        }
    }

    JwtDecoder apiDecoder(OAuth2TokenValidator<Jwt> extra) {
        NimbusJwtDecoder apiDecoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        apiDecoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefault(), extra));
        return apiDecoder;
    }

    private String encode(JwtClaimsSet.Builder claims) {
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims.build()))
                .getTokenValue();
    }
}
