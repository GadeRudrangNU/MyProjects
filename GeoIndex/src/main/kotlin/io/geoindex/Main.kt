package io.geoindex

import io.geoindex.api.geoIndexModule
import io.geoindex.service.DemoFeed
import io.geoindex.service.GeoService
import io.geoindex.service.ServiceConfig
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import org.slf4j.LoggerFactory
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

fun main() {
    val log = LoggerFactory.getLogger("geoindex")
    val config = ServiceConfig.fromEnv()
    val service = GeoService(config).start()
    val feed = if (config.demo) DemoFeed(service, config.demoEntities).also { it.start() } else null

    val reporter = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "geoindex-reporter").apply { isDaemon = true } }
    reporter.scheduleWithFixedDelay(
        { log.info("[metrics] {}", service.summaryLine()) },
        config.reportIntervalSeconds.toLong(), config.reportIntervalSeconds.toLong(), TimeUnit.SECONDS,
    )

    val server = embeddedServer(Netty, port = config.port, host = config.host) { geoIndexModule(service) }
    Runtime.getRuntime().addShutdownHook(Thread {
        feed?.close()
        reporter.shutdownNow()
        service.close()
        server.stop(500, 2_000)
    })
    log.info("GeoIndex using the {} index on http://localhost:{}", config.indexType.name.lowercase(), config.port)
    server.start(wait = true)
}
