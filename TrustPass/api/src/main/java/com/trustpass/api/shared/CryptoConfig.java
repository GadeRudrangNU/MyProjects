package com.trustpass.api.shared;

import com.trustpass.common.FieldCrypto;
import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class CryptoConfig {

    @Bean
    FieldCrypto fieldCrypto(TrustPassProperties props) {
        return new FieldCrypto(props.security().encryptionKey());
    }

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}
