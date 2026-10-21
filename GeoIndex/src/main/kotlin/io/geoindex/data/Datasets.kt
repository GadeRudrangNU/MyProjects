package io.geoindex.data

import io.geoindex.geo.GeoBounds
import io.geoindex.geo.Projection
import java.io.File
import java.util.SplittableRandom
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

class LatLon(@JvmField val lat: Double, @JvmField val lon: Double)

/** A source of positions and query points over a fixed bounding box. */
interface Dataset {
    val bounds: GeoBounds

    /** [n] positions; sources with fewer than [n] rows repeat with jitter so sizes stay comparable. */
    fun positions(n: Int): List<LatLon>

    /** A query point following the same spatial distribution as the data. */
    fun querySample(rng: SplittableRandom): LatLon

    /** One random-walk step from [p] of at most about [meters], kept inside the bounds. */
    fun step(p: LatLon, rng: SplittableRandom, meters: Double): LatLon
}

/**
 * Clustered points in a city-sized box: a fixed-seed mixture of Gaussian hot spots with
 * log-normal popularity, plus a thin uniform background. Dense downtown-like cores sit next to
 * sparse outskirts, which is the shape that separates fixed grids from adaptive trees.
 */
class SyntheticCity(
    override val bounds: GeoBounds = GeoBounds.NEW_YORK,
    private val seed: Long = 42,
    clusterCount: Int = 40,
    private val backgroundShare: Double = 0.10,
) : Dataset {
    private val projection = Projection.centeredOn(bounds)
    private val minX = projection.x(bounds.minLon)
    private val maxX = projection.x(bounds.maxLon)
    private val minY = projection.y(bounds.minLat)
    private val maxY = projection.y(bounds.maxLat)

    private class Cluster(val x: Double, val y: Double, val sigma: Double, val cumulativeWeight: Double)

    private val clusters: List<Cluster>
    private val totalWeight: Double

    init {
        val rng = SplittableRandom(seed)
        val raw = List(clusterCount) {
            val w = exp(rng.nextGaussian())
            Triple(rng.nextDouble(minX + 2_000, maxX - 2_000), rng.nextDouble(minY + 2_000, maxY - 2_000), w) to
                rng.nextDouble(250.0, 2_500.0)
        }
        var acc = 0.0
        clusters = raw.map { (t, sigma) ->
            acc += t.third
            Cluster(t.first, t.second, sigma, acc)
        }
        totalWeight = acc
    }

    override fun positions(n: Int): List<LatLon> {
        val rng = SplittableRandom(seed xor 0x5DEECE66DL)
        return List(n) { sample(rng) }
    }

    fun sample(rng: SplittableRandom): LatLon {
        if (rng.nextDouble() < backgroundShare) {
            return toLatLon(rng.nextDouble(minX, maxX), rng.nextDouble(minY, maxY))
        }
        val pick = rng.nextDouble() * totalWeight
        val c = clusters.firstOrNull { it.cumulativeWeight >= pick } ?: clusters.last()
        while (true) {
            val x = c.x + rng.nextGaussian() * c.sigma
            val y = c.y + rng.nextGaussian() * c.sigma
            if (x in minX..maxX && y in minY..maxY) return toLatLon(x, y)
        }
    }

    override fun querySample(rng: SplittableRandom): LatLon = sample(rng)

    override fun step(p: LatLon, rng: SplittableRandom, meters: Double): LatLon {
        val x = reflect(projection.x(p.lon) + rng.nextGaussian() * meters, minX, maxX)
        val y = reflect(projection.y(p.lat) + rng.nextGaussian() * meters, minY, maxY)
        return toLatLon(x, y)
    }

    /** Bounces a coordinate off the box edge so walkers do not pile up along the boundary. */
    private fun reflect(v: Double, lo: Double, hi: Double): Double {
        val r = if (v < lo) 2 * lo - v else if (v > hi) 2 * hi - v else v
        return min(hi, max(lo, r))
    }

    private fun toLatLon(x: Double, y: Double): LatLon {
        // Guard against the projection round trip landing a hair outside the box.
        val lat = min(bounds.maxLat, max(bounds.minLat, projection.lat(y)))
        val lon = min(bounds.maxLon, max(bounds.minLon, projection.lon(x)))
        return LatLon(lat, lon)
    }
}

/**
 * Real coordinates from a CSV file with a header row, such as OpenStreetMap merchant exports or
 * historic taxi pickups. Rows outside [bounds] or with unparseable coordinates are skipped.
 */
class CsvDataset(
    file: File,
    override val bounds: GeoBounds,
    latColumn: String? = null,
    lonColumn: String? = null,
) : Dataset {
    private val points: List<LatLon>
    private val projection = Projection.centeredOn(bounds)

    init {
        val lines = file.useLines { it.toList() }
        require(lines.isNotEmpty()) { "${file.name} is empty" }
        val header = splitCsv(lines.first()).map { it.trim().lowercase() }
        fun column(explicit: String?, candidates: List<String>): Int {
            val wanted = explicit?.lowercase()?.let { listOf(it) } ?: candidates
            return header.indexOfFirst { it in wanted }.also {
                require(it >= 0) { "no column named ${wanted.joinToString(" or ")} in ${file.name}" }
            }
        }
        val latIdx = column(latColumn, LAT_NAMES)
        val lonIdx = column(lonColumn, LON_NAMES)
        points = lines.drop(1).mapNotNull { line ->
            val cells = splitCsv(line)
            val lat = cells.getOrNull(latIdx)?.trim()?.toDoubleOrNull()
            val lon = cells.getOrNull(lonIdx)?.trim()?.toDoubleOrNull()
            if (lat != null && lon != null && bounds.contains(lat, lon)) LatLon(lat, lon) else null
        }
        require(points.isNotEmpty()) { "no usable rows inside the bounds in ${file.name}" }
    }

    val rowCount: Int get() = points.size

    override fun positions(n: Int): List<LatLon> {
        if (n <= points.size) return points.subList(0, n)
        val rng = SplittableRandom(7)
        return List(n) { i -> if (i < points.size) points[i] else step(points[rng.nextInt(points.size)], rng, 15.0) }
    }

    override fun querySample(rng: SplittableRandom): LatLon = points[rng.nextInt(points.size)]

    override fun step(p: LatLon, rng: SplittableRandom, meters: Double): LatLon {
        val x = projection.x(p.lon) + rng.nextGaussian() * meters
        val y = projection.y(p.lat) + rng.nextGaussian() * meters
        val lat = min(bounds.maxLat, max(bounds.minLat, projection.lat(y)))
        val lon = min(bounds.maxLon, max(bounds.minLon, projection.lon(x)))
        return LatLon(lat, lon)
    }

    private fun splitCsv(line: String): List<String> = line.split(',').map { it.trim('"') }

    private companion object {
        val LAT_NAMES = listOf("lat", "latitude", "pickup_latitude")
        val LON_NAMES = listOf("lon", "lng", "long", "longitude", "pickup_longitude")
    }
}
