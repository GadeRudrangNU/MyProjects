package io.geoindex.service

import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.Gauge
import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.Timer
import io.micrometer.prometheusmetrics.PrometheusConfig
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry
import kotlinx.serialization.Serializable
import java.time.Duration
import java.util.concurrent.TimeUnit

@Serializable
data class LatencyStats(
    val count: Long,
    val meanMs: Double,
    val p50Ms: Double,
    val p95Ms: Double,
    val p99Ms: Double,
    val maxMs: Double,
)

@Serializable
data class ThroughputStats(
    val updatesPerSecond: Double,
    val nearestPerSecond: Double,
    val withinPerSecond: Double,
)

@Serializable
data class MetricsSnapshot(
    val uptimeSeconds: Long,
    val indexType: String,
    val indexSize: Int,
    val queueDepth: Int,
    val queueCapacity: Int,
    val expiryHeapSize: Int,
    val zones: Int,
    val subscribers: Int,
    val updatesApplied: Long,
    val updatesStale: Long,
    val updatesRejected: Long,
    val batchesRejectedQueueFull: Long,
    val entitiesExpired: Long,
    val eventsPublished: Long,
    val eventsDropped: Long,
    val throughput: ThroughputStats,
    val updateLatency: LatencyStats,
    val nearestLatency: LatencyStats,
    val withinLatency: LatencyStats,
    val queueWaitLatency: LatencyStats,
)

/**
 * Micrometer meters for the service. Latency timers keep an HdrHistogram-backed percentile
 * distribution; the Prometheus registry doubles as the text exposition for scrapers.
 */
class ServiceMetrics(
    val registry: PrometheusMeterRegistry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT),
) {
    private val startNanos = System.nanoTime()

    val updateLatency = timer("geoindex.update.latency", "Time to apply one position update to the index")
    val nearestLatency = timer("geoindex.query.latency", "Nearest-k query time", "type", "nearest")
    val withinLatency = timer("geoindex.query.latency", "Radius query time", "type", "within")
    val queueWait = timer("geoindex.ingest.queue.wait", "Time a batch waits in the ingest queue")

    val updatesApplied: Counter = counter("geoindex.updates.applied")
    val updatesStale: Counter = counter("geoindex.updates.stale")
    val updatesRejected: Counter = counter("geoindex.updates.rejected")
    val batchesRejected: Counter = counter("geoindex.ingest.rejected.queue.full")
    val entitiesExpired: Counter = counter("geoindex.entities.expired")
    val nearestQueries: Counter = counter("geoindex.queries", "type", "nearest")
    val withinQueries: Counter = counter("geoindex.queries", "type", "within")

    private val window = ThroughputWindow(
        { updatesApplied.count().toLong() },
        { nearestQueries.count().toLong() },
        { withinQueries.count().toLong() },
    )

    fun bindGauges(indexSize: () -> Number, queueDepth: () -> Number, expiryHeap: () -> Number, zones: () -> Number, subscribers: () -> Number) {
        Gauge.builder("geoindex.index.size") { indexSize().toDouble() }.register(registry)
        Gauge.builder("geoindex.ingest.queue.depth") { queueDepth().toDouble() }.register(registry)
        Gauge.builder("geoindex.expiry.heap.size") { expiryHeap().toDouble() }.register(registry)
        Gauge.builder("geoindex.zones") { zones().toDouble() }.register(registry)
        Gauge.builder("geoindex.event.subscribers") { subscribers().toDouble() }.register(registry)
    }

    /** Records one throughput sample; the reporter calls this about once a second. */
    fun sampleThroughput() = window.sample()

    fun throughput(): ThroughputStats = window.rates()

    fun uptimeSeconds(): Long = TimeUnit.NANOSECONDS.toSeconds(System.nanoTime() - startNanos)

    fun scrape(): String = registry.scrape()

    private fun timer(name: String, description: String, vararg tags: String): Timer =
        Timer.builder(name)
            .description(description)
            .tags(*tags)
            .publishPercentiles(0.5, 0.95, 0.99)
            .percentilePrecision(2)
            .minimumExpectedValue(Duration.ofNanos(100))
            .maximumExpectedValue(Duration.ofSeconds(30))
            .register(registry)

    private fun counter(name: String, vararg tags: String): Counter = Counter.builder(name).tags(*tags).register(registry)

    companion object {
        fun latencyOf(timer: Timer): LatencyStats {
            val snap = timer.takeSnapshot()
            fun at(p: Double) = snap.percentileValues()
                .firstOrNull { it.percentile() == p }?.value(TimeUnit.MILLISECONDS) ?: 0.0
            return LatencyStats(
                count = snap.count(),
                meanMs = snap.mean(TimeUnit.MILLISECONDS),
                p50Ms = at(0.5),
                p95Ms = at(0.95),
                p99Ms = at(0.99),
                maxMs = snap.max(TimeUnit.MILLISECONDS),
            )
        }
    }
}

/** Per-second rates averaged over the trailing few samples. */
class ThroughputWindow(
    private val updates: () -> Long,
    private val nearest: () -> Long,
    private val within: () -> Long,
    private val samples: Int = 5,
) {
    private class Sample(val nanos: Long, val updates: Long, val nearest: Long, val within: Long)

    private val ring = ArrayDeque<Sample>()

    @Synchronized
    fun sample(now: Long = System.nanoTime()) {
        ring.addLast(Sample(now, updates(), nearest(), within()))
        while (ring.size > samples + 1) ring.removeFirst()
    }

    @Synchronized
    fun rates(): ThroughputStats {
        if (ring.size < 2) return ThroughputStats(0.0, 0.0, 0.0)
        val a = ring.first()
        val b = ring.last()
        val seconds = (b.nanos - a.nanos) / 1e9
        if (seconds <= 0) return ThroughputStats(0.0, 0.0, 0.0)
        return ThroughputStats(
            (b.updates - a.updates) / seconds,
            (b.nearest - a.nearest) / seconds,
            (b.within - a.within) / seconds,
        )
    }
}
