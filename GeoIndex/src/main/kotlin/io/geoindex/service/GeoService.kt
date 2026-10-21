package io.geoindex.service

import io.geoindex.geo.Projection
import io.geoindex.index.Item
import io.geoindex.index.Neighbor
import io.geoindex.index.SpatialIndex
import org.slf4j.LoggerFactory
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** A position report as received from a client. A null [ts] means "now". */
data class PositionUpdate(val id: String, val lat: Double, val lon: Double, val ts: Long? = null)

/** An entity as returned by queries. [distanceMeters] is set on query hits. */
data class Located(
    val id: String,
    val lat: Double,
    val lon: Double,
    val ts: Long,
    val distanceMeters: Double? = null,
)

data class RangeResult(val hits: List<Located>, val total: Int, val truncated: Boolean)

sealed interface SubmitResult {
    data class Accepted(val accepted: Int, val rejected: Int, val firstError: String?, val queueDepth: Int) : SubmitResult
    data class QueueFull(val queueDepth: Int, val capacity: Int) : SubmitResult
}

/**
 * The service core: validates and queues position batches, applies them to the spatial index,
 * answers queries, expires silent entities and raises zone enter and exit events.
 */
class GeoService(
    val config: ServiceConfig = ServiceConfig(),
    private val clock: Clock = Clock.SYSTEM,
    val metrics: ServiceMetrics = ServiceMetrics(),
) : AutoCloseable {
    val projection: Projection = Projection.centeredOn(config.bounds)
    val index: SpatialIndex = config.createIndex(planeOf(config.bounds, projection))
    val zones = ZoneRegistry(projection)
    val events = EventHub()

    private class Batch(val items: List<Item>, val enqueuedNanos: Long)

    private val log = LoggerFactory.getLogger(GeoService::class.java)
    private val queue = ArrayBlockingQueue<Batch>(config.queueCapacity)
    private val pending = AtomicInteger()
    private val expiry = ExpiryQueue()
    private val workers = ArrayList<Thread>()
    private var scheduler: ScheduledExecutorService? = null

    @Volatile
    private var running = true

    /** Current time according to the service clock. */
    fun nowMillis(): Long = clock.nowMillis()

    val queueDepth: Int get() = queue.size
    val queueCapacity: Int get() = config.queueCapacity

    init {
        metrics.bindGauges(
            indexSize = { index.size },
            queueDepth = { queue.size },
            expiryHeap = { expiry.size },
            zones = { zones.size },
            subscribers = { events.subscriberCount },
        )
    }

    /** Starts ingest workers, the expiry sweeper and the throughput sampler. */
    fun start(): GeoService {
        startIngestWorkers(config.ingestWorkers)
        val ex = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "geoindex-maintenance").apply { isDaemon = true } }
        ex.scheduleWithFixedDelay(::sweepSafely, config.sweepIntervalMillis, config.sweepIntervalMillis, TimeUnit.MILLISECONDS)
        ex.scheduleWithFixedDelay(metrics::sampleThroughput, 1, 1, TimeUnit.SECONDS)
        scheduler = ex
        return this
    }

    fun startIngestWorkers(count: Int) {
        repeat(count) {
            val t = Thread(::workerLoop, "geoindex-ingest-${workers.size}").apply { isDaemon = true }
            synchronized(workers) { workers.add(t) }
            t.start()
        }
    }

    private fun workerLoop() {
        while (running) {
            val batch = try {
                queue.poll(200, TimeUnit.MILLISECONDS) ?: continue
            } catch (ignored: InterruptedException) {
                return
            }
            try {
                metrics.queueWait.record(System.nanoTime() - batch.enqueuedNanos, TimeUnit.NANOSECONDS)
                applyBatch(batch.items)
            } catch (e: Exception) {
                log.error("failed to apply batch of {} updates", batch.items.size, e)
            } finally {
                pending.decrementAndGet()
            }
        }
    }

    private fun sweepSafely() {
        try {
            expireNow()
        } catch (e: Exception) {
            log.error("expiry sweep failed", e)
        }
    }

    // ---- ingest ----

    private fun validate(u: PositionUpdate, now: Long): String? {
        if (u.id.isBlank() || u.id.length > MAX_ID_LENGTH) return "id must be 1-$MAX_ID_LENGTH characters"
        if (!u.lat.isFinite() || !u.lon.isFinite()) return "lat and lon must be finite numbers"
        if (!config.bounds.contains(u.lat, u.lon)) return "position is outside the service bounds"
        val ts = u.ts ?: now
        if (ts > now + config.maxFutureSkewMillis) return "timestamp is too far in the future"
        if (ts < now - config.ttlMillis) return "timestamp is older than the expiry window"
        return null
    }

    /** Converts a client update to an index item in the projected plane. */
    fun toItem(u: PositionUpdate, now: Long = clock.nowMillis()): Item = Item(u.id, projection.x(u.lon), projection.y(u.lat), u.ts ?: now)

    /**
     * Validates a batch and offers it to the ingest queue without blocking. A full queue yields
     * [SubmitResult.QueueFull] so callers can answer 429 and the client can back off.
     */
    fun submit(updates: List<PositionUpdate>): SubmitResult {
        require(updates.size <= config.maxBatchSize) { "batch exceeds ${config.maxBatchSize} updates" }
        val now = clock.nowMillis()
        val items = ArrayList<Item>(updates.size)
        var rejected = 0
        var firstError: String? = null
        for (u in updates) {
            val error = validate(u, now)
            if (error == null) {
                items.add(toItem(u, now))
            } else {
                rejected++
                if (firstError == null) firstError = "${u.id.take(MAX_ID_LENGTH)}: $error"
            }
        }
        if (rejected > 0) metrics.updatesRejected.increment(rejected.toDouble())
        if (items.isEmpty()) return SubmitResult.Accepted(0, rejected, firstError, queue.size)

        pending.incrementAndGet()
        if (!queue.offer(Batch(items, System.nanoTime()))) {
            pending.decrementAndGet()
            metrics.batchesRejected.increment()
            return SubmitResult.QueueFull(queue.size, config.queueCapacity)
        }
        return SubmitResult.Accepted(items.size, rejected, firstError, queue.size)
    }

    /** Applies already-validated items directly, bypassing the queue. Used by workers and in-process load. */
    fun applyBatch(items: List<Item>) {
        for (item in items) apply(item)
    }

    fun apply(item: Item) {
        val start = System.nanoTime()
        val result = index.upsert(item)
        if (!result.applied) {
            metrics.updatesStale.increment()
            return
        }
        metrics.updatesApplied.increment()
        val previous = result.previous
        if (previous == null) expiry.track(item.id, item.ts)
        detectTransitions(previous, item)
        metrics.updateLatency.record(System.nanoTime() - start, TimeUnit.NANOSECONDS)
    }

    private fun detectTransitions(previous: Item?, current: Item) {
        val shapes = zones.shapes()
        if (shapes.isEmpty()) return
        for (shape in shapes) {
            val was = previous != null && shape.contains(previous)
            val now = shape.contains(current)
            if (was != now) events.publish(eventFor(if (now) "enter" else "exit", shape.zone.id, current, null))
        }
    }

    private fun eventFor(type: String, zoneId: String, item: Item, reason: String?) =
        ZoneEvent(type, zoneId, item.id, projection.lat(item.y), projection.lon(item.x), item.ts, reason)

    private fun raiseExits(item: Item, reason: String) {
        for (shape in zones.shapes()) {
            if (shape.contains(item)) events.publish(eventFor("exit", shape.zone.id, item, reason))
        }
    }

    /** Blocks until every accepted batch has been applied, or [timeoutMillis] passes. */
    fun awaitIdle(timeoutMillis: Long = 30_000): Boolean {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
        while (pending.get() > 0) {
            if (System.nanoTime() > deadline) return false
            Thread.sleep(2)
        }
        return true
    }

    // ---- expiry ----

    /** Expires every entity silent for longer than the ttl; returns how many were removed. */
    fun expireNow(): Int {
        val cutoff = clock.nowMillis() - config.ttlMillis
        val removed = expiry.sweep(index, cutoff) { item ->
            metrics.entitiesExpired.increment()
            raiseExits(item, "expired")
        }
        return removed
    }

    fun remove(id: String): Located? {
        val removed = index.remove(id) ?: return null
        raiseExits(removed, "removed")
        return locate(removed, null)
    }

    // ---- queries ----

    fun get(id: String): Located? = index[id]?.let { locate(it, null) }

    fun nearest(lat: Double, lon: Double, k: Int): List<Located> {
        val start = System.nanoTime()
        val hits = index.nearest(projection.x(lon), projection.y(lat), k)
        metrics.nearestLatency.record(System.nanoTime() - start, TimeUnit.NANOSECONDS)
        metrics.nearestQueries.increment()
        return hits.map(::locateHit)
    }

    fun within(lat: Double, lon: Double, radiusMeters: Double, limit: Int = config.maxResults): RangeResult {
        val start = System.nanoTime()
        val hits = index.withinRadius(projection.x(lon), projection.y(lat), radiusMeters)
        metrics.withinLatency.record(System.nanoTime() - start, TimeUnit.NANOSECONDS)
        metrics.withinQueries.increment()
        val shown = if (hits.size > limit) hits.subList(0, limit) else hits
        return RangeResult(shown.map(::locateHit), hits.size, hits.size > limit)
    }

    private fun locateHit(n: Neighbor) = locate(n.item, n.distance)

    private fun locate(item: Item, distance: Double?) =
        Located(item.id, projection.lat(item.y), projection.lon(item.x), item.ts, distance)

    // ---- observability ----

    fun snapshot(): MetricsSnapshot = MetricsSnapshot(
        uptimeSeconds = metrics.uptimeSeconds(),
        indexType = config.indexType.name.lowercase(),
        indexSize = index.size,
        queueDepth = queue.size,
        queueCapacity = config.queueCapacity,
        expiryHeapSize = expiry.size,
        zones = zones.size,
        subscribers = events.subscriberCount,
        updatesApplied = metrics.updatesApplied.count().toLong(),
        updatesStale = metrics.updatesStale.count().toLong(),
        updatesRejected = metrics.updatesRejected.count().toLong(),
        batchesRejectedQueueFull = metrics.batchesRejected.count().toLong(),
        entitiesExpired = metrics.entitiesExpired.count().toLong(),
        eventsPublished = events.published,
        eventsDropped = events.dropped,
        throughput = metrics.throughput(),
        updateLatency = ServiceMetrics.latencyOf(metrics.updateLatency),
        nearestLatency = ServiceMetrics.latencyOf(metrics.nearestLatency),
        withinLatency = ServiceMetrics.latencyOf(metrics.withinLatency),
        queueWaitLatency = ServiceMetrics.latencyOf(metrics.queueWait),
    )

    /** One-line summary printed to the console by the reporter. */
    fun summaryLine(): String {
        val s = snapshot()
        fun l(x: LatencyStats) = "%.3f/%.3f/%.3f".format(x.p50Ms, x.p95Ms, x.p99Ms)
        return "index=${s.indexType} size=${s.indexSize} queue=${s.queueDepth}/${s.queueCapacity} " +
            "updates/s=${"%.0f".format(s.throughput.updatesPerSecond)} " +
            "nearest/s=${"%.0f".format(s.throughput.nearestPerSecond)} " +
            "within/s=${"%.0f".format(s.throughput.withinPerSecond)} " +
            "update p50/p95/p99 ms=${l(s.updateLatency)} nearest=${l(s.nearestLatency)} within=${l(s.withinLatency)} " +
            "rejected429=${s.batchesRejectedQueueFull} expired=${s.entitiesExpired}"
    }

    override fun close() {
        running = false
        scheduler?.shutdownNow()
        synchronized(workers) { workers.forEach { it.interrupt() } }
    }

    private companion object {
        const val MAX_ID_LENGTH = 128
    }
}
