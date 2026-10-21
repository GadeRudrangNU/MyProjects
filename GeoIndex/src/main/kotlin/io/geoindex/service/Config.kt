package io.geoindex.service

import io.geoindex.geo.GeoBounds
import io.geoindex.geo.Projection
import io.geoindex.index.BruteForceIndex
import io.geoindex.index.GridIndex
import io.geoindex.index.QuadTreeIndex
import io.geoindex.index.Rect
import io.geoindex.index.SpatialIndex

fun interface Clock {
    fun nowMillis(): Long

    companion object {
        val SYSTEM = Clock { System.currentTimeMillis() }
    }
}

enum class IndexType {
    BRUTE, GRID, QUADTREE;

    companion object {
        fun parse(value: String): IndexType =
            entries.firstOrNull { it.name.equals(value.trim(), ignoreCase = true) }
                ?: throw IllegalArgumentException("unknown index type '$value' (expected brute, grid or quadtree)")
    }
}

/** Builds the planar rectangle covering [bounds] in the projection's coordinates. */
fun planeOf(bounds: GeoBounds, projection: Projection) = Rect(
    projection.x(bounds.minLon), projection.y(bounds.minLat),
    projection.x(bounds.maxLon), projection.y(bounds.maxLat),
)

data class ServiceConfig(
    val host: String = "0.0.0.0",
    val port: Int = 7070,
    val bounds: GeoBounds = GeoBounds.NEW_YORK,
    val indexType: IndexType = IndexType.QUADTREE,
    val gridCellMeters: Double = 250.0,
    val quadLeafCapacity: Int = 32,
    val quadTilesPerSide: Int = 8,
    val gridStripes: Int = 64,
    val ttlMillis: Long = 5 * 60_000L,
    val sweepIntervalMillis: Long = 1_000L,
    val queueCapacity: Int = 1_024,
    val maxBatchSize: Int = 1_000,
    val ingestWorkers: Int = 4,
    val maxK: Int = 1_000,
    val maxRadiusMeters: Double = 50_000.0,
    val maxResults: Int = 10_000,
    val maxFutureSkewMillis: Long = 5 * 60_000L,
    val reportIntervalSeconds: Int = 10,
    val demo: Boolean = false,
    val demoEntities: Int = 2_000,
) {
    init {
        require(port in 0..65535) { "port out of range" }
        require(ttlMillis > 0) { "ttl must be positive" }
        require(queueCapacity > 0) { "queue capacity must be positive" }
        require(maxBatchSize > 0) { "max batch size must be positive" }
        require(ingestWorkers >= 0) { "ingest workers must not be negative" }
    }

    fun createIndex(plane: Rect): SpatialIndex = when (indexType) {
        IndexType.BRUTE -> BruteForceIndex()
        IndexType.GRID -> GridIndex(plane, gridCellMeters, gridStripes)
        IndexType.QUADTREE -> QuadTreeIndex(plane, quadLeafCapacity, quadTilesPerSide)
    }

    companion object {
        /** Reads GEOINDEX_* variables; anything unset keeps its default. */
        fun fromEnv(env: Map<String, String> = System.getenv()): ServiceConfig {
            val d = ServiceConfig()
            fun str(name: String) = env["GEOINDEX_$name"]?.takeIf { it.isNotBlank() }
            val bounds = str("BOUNDS")?.let { raw ->
                val p = raw.split(",").map { it.trim().toDouble() }
                require(p.size == 4) { "GEOINDEX_BOUNDS must be minLat,minLon,maxLat,maxLon" }
                GeoBounds(p[0], p[1], p[2], p[3])
            } ?: d.bounds
            return ServiceConfig(
                host = str("HOST") ?: d.host,
                port = str("PORT")?.toInt() ?: d.port,
                bounds = bounds,
                indexType = str("INDEX")?.let(IndexType::parse) ?: d.indexType,
                gridCellMeters = str("GRID_CELL_METERS")?.toDouble() ?: d.gridCellMeters,
                quadLeafCapacity = str("QUAD_LEAF_CAPACITY")?.toInt() ?: d.quadLeafCapacity,
                quadTilesPerSide = str("QUAD_TILES")?.toInt() ?: d.quadTilesPerSide,
                gridStripes = str("GRID_STRIPES")?.toInt() ?: d.gridStripes,
                ttlMillis = str("TTL_SECONDS")?.let { (it.toDouble() * 1000).toLong() } ?: d.ttlMillis,
                sweepIntervalMillis = str("SWEEP_INTERVAL_MS")?.toLong() ?: d.sweepIntervalMillis,
                queueCapacity = str("QUEUE_CAPACITY")?.toInt() ?: d.queueCapacity,
                maxBatchSize = str("MAX_BATCH")?.toInt() ?: d.maxBatchSize,
                ingestWorkers = str("INGEST_WORKERS")?.toInt() ?: d.ingestWorkers,
                maxK = str("MAX_K")?.toInt() ?: d.maxK,
                maxRadiusMeters = str("MAX_RADIUS_METERS")?.toDouble() ?: d.maxRadiusMeters,
                maxResults = str("MAX_RESULTS")?.toInt() ?: d.maxResults,
                reportIntervalSeconds = str("REPORT_INTERVAL_SECONDS")?.toInt() ?: d.reportIntervalSeconds,
                demo = str("DEMO")?.toBooleanStrictOrNull() ?: d.demo,
                demoEntities = str("DEMO_ENTITIES")?.toInt() ?: d.demoEntities,
            )
        }
    }
}
