package com.trustpass.api.shared;

import com.trustpass.common.EmbeddedDatabase;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.nio.file.Path;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration
class DatabaseConfig {

    @Bean(destroyMethod = "close")
    DataSource dataSource(TrustPassProperties props, Environment env) {
        HikariConfig config = new HikariConfig();
        TrustPassProperties.Db db = props.db();
        if (db.embedded()) {
            Path dir = db.port() > 0 ? Path.of(db.dataDir()).toAbsolutePath() : null;
            int port = EmbeddedDatabase.start(db.port(), dir);
            config.setJdbcUrl(EmbeddedDatabase.jdbcUrl(port));
            config.setUsername("postgres");
            config.setPassword("postgres");
        } else {
            config.setJdbcUrl(env.getRequiredProperty("spring.datasource.url"));
            config.setUsername(env.getProperty("spring.datasource.username"));
            config.setPassword(env.getProperty("spring.datasource.password"));
        }
        config.setMaximumPoolSize(env.getProperty("trustpass.db.pool-size", Integer.class, 20));
        config.setPoolName("trustpass");
        return new HikariDataSource(config);
    }
}
