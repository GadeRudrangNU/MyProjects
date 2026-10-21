package io.geoindex.loadgen

import io.geoindex.data.CsvDataset
import io.geoindex.data.Dataset
import io.geoindex.data.LatLon
import io.geoindex.data.SyntheticCity
import io.geoindex.geo.GeoBounds
import io.geoindex.service.GeoService
import io.geoindex.service.IndexType
import io.geoindex.service.PositionUpdate
import io.geoindex.service.ServiceConfig
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.HdrHistogram.Histogram
import java.io.File
import java.util.SplittableRandom
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.LockSupport

data class LoadConfig(
    val target: String = "inprocess",
    val index: IndexType = IndexType.QUADTREE,
    val points: Int = 100_000,
    val durationSeconds: Int = 20,
    val warmupSeconds: Int = 5,
    val updateRate: Int = 10_000,
    val batch: Int = 100,
    val nearestRate: Int = 2_000,
    val withinRate: Int = 200,
    val k: Int = 10,
    val radiusMeters: Double = 500.0,
    val updateThreads: Int = 2,
    val nearestThreads: Int = 4,
    val withinThreads: Int = 2,
    val url: String = "http://localhost:7070",
    val seed: Long = 42,
    val dataset: String = "synthetic",
    val file: String? = null,
    val gridCellMeters: Double = 250.0,
    val out: String? = null,
) {
    init {
        require(target in setOf("inprocess", "http")) { "--target must be inprocess or http" }
        require(points >= 0 && durationSeconds > 0 && warmupSeconds >= 0) { "invalid sizes" }
        require(batch > 0) { "batch must be positive" }
        require(updateThreads > 0 && nearestThreads > 0 && withinThreads > 0) { "thread counts must be positive" }
        require(updateRate >= 0 && nearestRate >= 0 && withinRate >= 0) { "rates must not be negative" }
    }

    val threads: Int get() = updateThreads + nearestThreads + withinThreads

    companion object {
        fun parse(args: Array<String>): LoadConfig {
            val flags = HashMap<String, String>()
            var i = 0
            while (i < args.size) {
                val a = args[i]
                require(a.startsWith("--")) { "unexpected argument '$a'" }
                require(i + 1 < args.size) { "missing value for $a" }
                flags[a.removePrefix("--")] = args[i + 1]
                i += 2
            }
            val d = LoadConfig()
            val known = setOf(
                "target", "index", "points", "duration", "warmup", "update-rate", "batch", "nearest-rate",
                "within-rate", "k", "radius", "update-threads", "nearest-threads", "within-threads", "url", "seed", "dataset", "file", "grid-cell", "out",
            )
            val unknown = flags.keys - known
            require(unknown.isEmpty()) { "unknown options: ${unknown.joinToString()}" }
            return LoadConfig(
                target = flags["target"] ?: d.target,
                index = flags["index"]?.let(IndexType::parse) ?: d.index,
                points = flags["points"]?.toInt() ?: d.points,
                durationSeconds = flags["duration"]?.toInt() ?: d.durationSeconds,
                warmupSeconds = flags["warmup"]?.toInt() ?: d.warmupSeconds,
                updateRate = flags["update-rate"]?.toInt() ?: d.updateRate,
                batch = flags["batch"]?.toInt() ?: d.batch,
                nearestRate = flags["nearest-rate"]?.toInt() ?: d.nearestRate,
                withinRate = flags["within-rate"]?.toInt() ?: d.withinRate,
                k = flags["k"]?.toInt() ?: d.k,
                radiusMeters = flags["radius"]?.toDouble() ?: d.radiusMeters,
                updateThreads = flags["update-threads"]?.toInt() ?: d.updateThreads,
                nearestThreads = flags["nearest-threads"]?.toInt() ?: d.nearestThreads,
                withinThreads = flags["within-threads"]?.toInt() ?: d.withinThreads,
                url = flags["url"] ?: d.url,
                seed = flags["seed"]?.toLong() ?: d.seed,
                dataset = flags["dataset"] ?: d.dataset,
                file = flags["file"],
                gridCellMeters = flags["grid-cell"]?.toDouble() ?: d.gridCellMeters,
                out = flags["out"],
            )
        }
    }
}

@Serializable
data class OpStats(
    val operations: Long,
    val perSecond: Double,
    val meanMs: Double,
    val p50Ms: Double,
    val p90Ms: Double,
    val p99Ms: Double,
    val p999Ms: Double,
    val maxMs: Double,
)

@Serializable
data class LoadReport(
    val target: String,
    val index: String,
    val points: Int,
    val dataset: String,
    val durationSeconds: Int,
    val threads: Int,
    val targetUpdatesPerSecond: Int,
    val updateBatchSize: Int,
    val targetNearestPerSecond: Int,
    val targetWithinPerSecond: Int,
    val updateBatch: OpStats,
    val nearest: OpStats,
    val within: OpStats,
    val achievedUpdatesPerSecond: Double,
    val rejectedBatches: Long,
    val errors: Long,
)

/** What a load target did with one request. */
enum class Outcome { OK, REJECTED, ERROR }

interface LoadTarget : AutoCloseable {
    fun update(batch: List<PositionUpdate>): Outcome
    fun nearest(lat: Double, lon: Double, k: Int): Outcome
    fun within(lat: Double, lon: Double, radiusMeters: Double): Outcome
    override fun close() {}
}

/** Calls the service core directly, so the figures isolate index and service cost from HTTP. */
class InProcessTarget(val service: GeoService) : LoadTarget {
    override fun update(batch: List<PositionUpdate>): Outcome {
        service.applyBatch(batch.map { service.toItem(it) })
        return Outcome.OK
    }

    override fun nearest(lat: Double, lon: Double, k: Int): Outcome {
        service.nearest(lat, lon, k)
        return Outcome.OK
    }

    override fun within(lat: Double, lon: Double, radiusMeters: Double): Outcome {
        service.within(lat, lon, radiusMeters)
        return Outcome.OK
    }
}

/**
 * Open-loop load: operations are issued on a fixed schedule and each latency is measured from the
 * moment the operation was due, not from when the thread got to it. A stall therefore shows up in
 * the percentiles of every operation queued behind it instead of being hidden (coordinated omission).
 */
class LoadRunner(
    private val cfg: LoadConfig,
    private val dataset: Dataset,
    private val targetFactory: () -> LoadTarget,
) {
    private class Recorder {
        val update = Histogram(HIGHEST_NANOS, 3)
        val nearest = Histogram(HIGHEST_NANOS, 3)
        val within = Histogram(HIGHEST_NANOS, 3)
        var rejected = 0L
        var errors = 0L
    }

    private val positions: Array<LatLon> by lazy { dataset.positions(cfg.points).toTypedArray() }

    /** Loads the initial population through [target], in parallel. */
    fun preload(target: LoadTarget) {
        val chunks = positions.indices.chunked(500)
        val workers = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
        val next = java.util.concurrent.atomic.AtomicInteger()
        val now = System.currentTimeMillis()
        val threads = List(workers) {
            Thread {
                while (true) {
                    val c = next.getAndIncrement()
                    if (c >= chunks.size) return@Thread
                    val batch = chunks[c].map { i -> PositionUpdate("e$i", positions[i].lat, positions[i].lon, now) }
                    var outcome = target.update(batch)
                    var attempts = 0
                    while (outcome == Outcome.REJECTED && attempts++ < 600) {
                        Thread.sleep(50)
                        outcome = target.update(batch)
                    }
                    check(outcome == Outcome.OK) { "preload failed: $outcome" }
                }
            }.also { it.start() }
        }
        threads.forEach { it.join() }
    }

    private enum class Role { UPDATE, NEAREST, WITHIN }

    fun run(): LoadReport {
        val roles = List(cfg.updateThreads) { Role.UPDATE } + List(cfg.nearestThreads) { Role.NEAREST } + List(cfg.withinThreads) { Role.WITHIN }
        fun intervalNanos(opsPerSecond: Double, workers: Int) = if (opsPerSecond > 0) (workers * 1e9 / opsPerSecond).toLong() else Long.MAX_VALUE
        val intervals = mapOf(
            Role.UPDATE to intervalNanos(if (positions.isEmpty()) 0.0 else cfg.updateRate.toDouble() / cfg.batch, cfg.updateThreads),
            Role.NEAREST to intervalNanos(cfg.nearestRate.toDouble(), cfg.nearestThreads),
            Role.WITHIN to intervalNanos(cfg.withinRate.toDouble(), cfg.withinThreads),
        )

        val recorders = List(roles.size) { Recorder() }
        val ready = CountDownLatch(roles.size)
        val go = CountDownLatch(1)
        val startNanos = AtomicLong()
        val workers = recorders.mapIndexed { w, rec ->
            Thread {
                val target = targetFactory()
                try {
                    ready.countDown()
                    go.await()
                    runWorker(w, roles[w], rec, target, startNanos.get(), intervals.getValue(roles[w]))
                } finally {
                    target.close()
                }
            }.apply { name = "loadgen-$w" }.also { it.start() }
        }
        ready.await()
        startNanos.set(System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(100))
        go.countDown()
        workers.forEach { it.join() }

        val update = Histogram(HIGHEST_NANOS, 3)
        val nearest = Histogram(HIGHEST_NANOS, 3)
        val within = Histogram(HIGHEST_NANOS, 3)
        recorders.forEach { update.add(it.update); nearest.add(it.nearest); within.add(it.within) }
        val seconds = cfg.durationSeconds.toDouble()
        return LoadReport(
            target = cfg.target,
            index = cfg.index.name.lowercase(),
            points = cfg.points,
            dataset = cfg.dataset,
            durationSeconds = cfg.durationSeconds,
            threads = cfg.threads,
            targetUpdatesPerSecond = cfg.updateRate,
            updateBatchSize = cfg.batch,
            targetNearestPerSecond = cfg.nearestRate,
            targetWithinPerSecond = cfg.withinRate,
            updateBatch = stats(update, seconds),
            nearest = stats(nearest, seconds),
            within = stats(within, seconds),
            achievedUpdatesPerSecond = update.totalCount * cfg.batch / seconds,
            rejectedBatches = recorders.sumOf { it.rejected },
            errors = recorders.sumOf { it.errors },
        )
    }

    private fun runWorker(w: Int, role: Role, rec: Recorder, target: LoadTarget, start: Long, interval: Long) {
        if (interval == Long.MAX_VALUE) return
        val rng = SplittableRandom(cfg.seed * 31 + w)
        val measureFrom = start + TimeUnit.SECONDS.toNanos(cfg.warmupSeconds.toLong())
        val end = measureFrom + TimeUnit.SECONDS.toNanos(cfg.durationSeconds.toLong())
        val peers = when (role) {
            Role.UPDATE -> cfg.updateThreads
            Role.NEAREST -> cfg.nearestThreads
            Role.WITHIN -> cfg.withinThreads
        }
        val rank = when (role) {
            Role.UPDATE -> w
            Role.NEAREST -> w - cfg.updateThreads
            Role.WITHIN -> w - cfg.updateThreads - cfg.nearestThreads
        }
        // Stagger peers so their schedules interleave instead of firing together.
        var due = start + interval * rank / peers
        val slice = positions.size / cfg.updateThreads
        val from = rank * slice
        val to = if (rank == cfg.updateThreads - 1) positions.size else from + slice

        while (due < end) {
            awaitNanoTime(due)
            val outcome: Outcome
            when (role) {
                Role.UPDATE -> {
                    val batch = ArrayList<PositionUpdate>(cfg.batch)
                    val now = System.currentTimeMillis()
                    repeat(cfg.batch) {
                        val i = from + rng.nextInt(to - from)
                        val p = dataset.step(positions[i], rng, 25.0)
                        positions[i] = p
                        batch.add(PositionUpdate("e$i", p.lat, p.lon, now))
                    }
                    outcome = target.update(batch)
                    record(rec.update, due, measureFrom, outcome, rec)
                }
                Role.NEAREST -> {
                    val q = dataset.querySample(rng)
                    outcome = target.nearest(q.lat, q.lon, cfg.k)
                    record(rec.nearest, due, measureFrom, outcome, rec)
                }
                Role.WITHIN -> {
                    val q = dataset.querySample(rng)
                    outcome = target.within(q.lat, q.lon, cfg.radiusMeters)
                    record(rec.within, due, measureFrom, outcome, rec)
                }
            }
            due += interval
        }
    }

    private fun record(h: Histogram, due: Long, measureFrom: Long, outcome: Outcome, rec: Recorder) {
        val finished = System.nanoTime()
        if (due < measureFrom) return
        when (outcome) {
            Outcome.OK -> h.recordValue((finished - due).coerceIn(1, HIGHEST_NANOS))
            Outcome.REJECTED -> rec.rejected++
            Outcome.ERROR -> rec.errors++
        }
    }

    private fun awaitNanoTime(deadline: Long) {
        while (true) {
            val remaining = deadline - System.nanoTime()
            if (remaining <= 0) return
            if (remaining > SPIN_THRESHOLD_NANOS) LockSupport.parkNanos(remaining - SPIN_THRESHOLD_NANOS) else Thread.onSpinWait()
        }
    }

    private fun stats(h: Histogram, seconds: Double): OpStats {
        fun ms(nanos: Long) = nanos / 1e6
        if (h.totalCount == 0L) return OpStats(0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        return OpStats(
            operations = h.totalCount,
            perSecond = h.totalCount / seconds,
            meanMs = h.mean / 1e6,
            p50Ms = ms(h.getValueAtPercentile(50.0)),
            p90Ms = ms(h.getValueAtPercentile(90.0)),
            p99Ms = ms(h.getValueAtPercentile(99.0)),
            p999Ms = ms(h.getValueAtPercentile(99.9)),
            maxMs = ms(h.maxValue),
        )
    }

    private companion object {
        const val HIGHEST_NANOS = 3_600_000_000_000L
        const val SPIN_THRESHOLD_NANOS = 20_000_000L
    }
}

fun datasetFor(cfg: LoadConfig, bounds: GeoBounds = GeoBounds.NEW_YORK): Dataset = when (cfg.dataset) {
    "synthetic" -> SyntheticCity(bounds, cfg.seed)
    "csv" -> CsvDataset(File(requireNotNull(cfg.file) { "--file is required with --dataset csv" }), bounds)
    else -> throw IllegalArgumentException("--dataset must be synthetic or csv")
}

fun formatReport(r: LoadReport): String {
    val sb = StringBuilder()
    sb.appendLine("GeoIndex load test: target=${r.target} index=${r.index} points=${r.points} dataset=${r.dataset}")
    sb.appendLine(
        "  duration=${r.durationSeconds}s threads=${r.threads} " +
            "updates=${r.targetUpdatesPerSecond}/s (batch ${r.updateBatchSize}) " +
            "nearest=${r.targetNearestPerSecond}/s within=${r.targetWithinPerSecond}/s",
    )
    sb.appendLine("  %-14s %10s %10s %9s %9s %9s %9s %9s".format("operation", "count", "per sec", "p50 ms", "p90 ms", "p99 ms", "p99.9 ms", "max ms"))
    for ((name, s) in listOf("update batch" to r.updateBatch, "nearest" to r.nearest, "within" to r.within)) {
        sb.appendLine(
            "  %-14s %10d %10.0f %9.3f %9.3f %9.3f %9.3f %9.3f".format(
                name, s.operations, s.perSecond, s.p50Ms, s.p90Ms, s.p99Ms, s.p999Ms, s.maxMs,
            ),
        )
    }
    sb.appendLine("  applied updates/s=%.0f rejected batches (429)=%d errors=%d".format(r.achievedUpdatesPerSecond, r.rejectedBatches, r.errors))
    return sb.toString()
}

private val reportJson = Json { prettyPrint = true }

/** Entry point: `./gradlew loadTest -PloadArgs="--points 1000000 --index quadtree"`. */
fun main(args: Array<String>) {
    val cfg = LoadConfig.parse(args)
    val dataset = datasetFor(cfg)
    val report = if (cfg.target == "inprocess") {
        val service = GeoService(ServiceConfig(indexType = cfg.index, gridCellMeters = cfg.gridCellMeters))
        val shared = InProcessTarget(service)
        val runner = LoadRunner(cfg, dataset) { shared }
        println("Preloading ${cfg.points} points into the ${cfg.index.name.lowercase()} index ...")
        val t0 = System.nanoTime()
        runner.preload(shared)
        println("Preloaded in %.1f s".format((System.nanoTime() - t0) / 1e9))
        System.gc()
        runner.run()
    } else {
        val runner = LoadRunner(cfg, dataset) { HttpTarget(cfg.url) }
        println("Preloading ${cfg.points} points through ${cfg.url} ...")
        HttpTarget(cfg.url).use { runner.preload(it) }
        runner.run()
    }
    print(formatReport(report))
    cfg.out?.let {
        val file = File(it)
        file.absoluteFile.parentFile?.mkdirs()
        file.writeText(reportJson.encodeToString(report))
        println("Wrote ${file.path}")
    }
}
