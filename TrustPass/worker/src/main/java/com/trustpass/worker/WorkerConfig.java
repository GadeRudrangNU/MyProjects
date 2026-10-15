package com.trustpass.worker;

import com.trustpass.common.EmbeddedDatabase;
import com.trustpass.common.FieldCrypto;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Duration;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration
class WorkerConfig {

    @Bean(destroyMethod = "close")
    DataSource dataSource(WorkerProperties props, Environment env) {
        HikariConfig config = new HikariConfig();
        String url = env.getProperty("spring.datasource.url");
        if (url == null) {
            int port = EmbeddedDatabase.awaitExisting(props.db().port(), Duration.ofSeconds(props.db().waitSeconds()));
            url = EmbeddedDatabase.jdbcUrl(port);
            config.setUsername("postgres");
            config.setPassword("postgres");
        } else {
            config.setUsername(env.getProperty("spring.datasource.username"));
            config.setPassword(env.getProperty("spring.datasource.password"));
        }
        config.setJdbcUrl(url);
        config.setMaximumPoolSize(props.db().poolSize());
        config.setPoolName("trustpass-worker");
        return new HikariDataSource(config);
    }

    @Bean
    FieldCrypto fieldCrypto(WorkerProperties props) {
        return new FieldCrypto(props.encryptionKey());
    }
}
