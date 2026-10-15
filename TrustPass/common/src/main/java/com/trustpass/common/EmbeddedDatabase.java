package com.trustpass.common;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class EmbeddedDatabase {

    public static final String DATABASE = "trustpass";
    private static final Logger log = LoggerFactory.getLogger(EmbeddedDatabase.class);
    private static EmbeddedPostgres instance;

    private EmbeddedDatabase() {
    }

    public static synchronized int start(int port, Path dataDir) {
        if (instance != null && port == 0) {
            return instance.getPort();
        }
        if (port > 0 && reachable(port)) {
            log.info("using postgres already listening on {}", port);
            return port;
        }
        try {
            EmbeddedPostgres.Builder builder = EmbeddedPostgres.builder()
                    .setServerConfig("max_connections", "300")
                    .setServerConfig("fsync", "off")
                    .setServerConfig("synchronous_commit", "off");
            if (port > 0) {
                builder.setPort(port);
            }
            if (dataDir != null) {
                Files.createDirectories(dataDir);
                builder.setDataDirectory(dataDir).setCleanDataDirectory(false);
            }
            instance = builder.start();
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                try {
                    instance.close();
                } catch (IOException ignored) {
                }
            }));
            int actual = instance.getPort();
            ensureDatabase(actual);
            log.info("embedded postgres started on {}", actual);
            return actual;
        } catch (IOException | SQLException e) {
            throw new IllegalStateException("could not start embedded postgres", e);
        }
    }

    public static int awaitExisting(int port, Duration timeout) {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            if (reachable(port)) {
                return port;
            }
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        throw new IllegalStateException("postgres not reachable on port " + port);
    }

    public static String jdbcUrl(int port) {
        return "jdbc:postgresql://localhost:" + port + "/" + DATABASE;
    }

    private static boolean reachable(int port) {
        try (Connection c = DriverManager.getConnection(
                "jdbc:postgresql://localhost:" + port + "/postgres", "postgres", "postgres")) {
            return c.isValid(2);
        } catch (SQLException e) {
            return false;
        }
    }

    private static void ensureDatabase(int port) throws SQLException {
        try (Connection c = DriverManager.getConnection(
                "jdbc:postgresql://localhost:" + port + "/postgres", "postgres", "postgres");
             Statement s = c.createStatement()) {
            var rs = s.executeQuery("select 1 from pg_database where datname = '" + DATABASE + "'");
            if (!rs.next()) {
                s.execute("create database " + DATABASE);
            }
        }
    }
}
