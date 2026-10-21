package io.geoindex.geo

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

const val EARTH_RADIUS_METERS = 6_371_008.8

/** Maximum relative error the planar approximation is designed to stay within. */
const val DISTANCE_ERROR_BOUND = 0.005

/** A latitude/longitude rectangle in degrees. */
data class GeoBounds(
    val minLat: Double,
    val minLon: Double,
    val maxLat: Double,
    val maxLon: Double,
) {
    init {
        require(minLat < maxLat && minLon < maxLon) { "bounds must have positive extent" }
        require(minLat >= -90.0 && maxLat <= 90.0) { "latitude must be within [-90, 90]" }
        require(minLon >= -180.0 && maxLon <= 180.0) { "longitude must be within [-180, 180]" }
    }

    val centerLat: Double get() = (minLat + maxLat) / 2
    val centerLon: Double get() = (minLon + maxLon) / 2

    fun contains(lat: Double, lon: Double): Boolean =
        lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon

    companion object {
        /** Greater New York City, roughly 44 km tall and 51 km wide. */
        val NEW_YORK = GeoBounds(minLat = 40.55, minLon = -74.30, maxLat = 40.95, maxLon = -73.70)
    }
}

/**
 * Equirectangular projection around a fixed origin. Distances in the projected plane are the
 * service's distance metric: they cost a multiply-add instead of the trigonometry in haversine,
 * and they let spatial indexes prune with plain rectangle arithmetic.
 *
 * The relative error against great-circle distance is dominated by the change of cos(latitude)
 * across the box, about tan(lat) times the half-height in radians. For boxes up to 0.5 degrees tall
 * at latitudes up to 45 degrees that stays below [DISTANCE_ERROR_BOUND] (0.5%).
 */
class Projection(val originLat: Double, val originLon: Double) {
    private val metersPerDegreeLat = Math.toRadians(1.0) * EARTH_RADIUS_METERS
    private val metersPerDegreeLon = metersPerDegreeLat * cos(Math.toRadians(originLat))

    fun x(lon: Double): Double = (lon - originLon) * metersPerDegreeLon
    fun y(lat: Double): Double = (lat - originLat) * metersPerDegreeLat
    fun lon(x: Double): Double = originLon + x / metersPerDegreeLon
    fun lat(y: Double): Double = originLat + y / metersPerDegreeLat

    /** Approximate great-circle distance in meters between two coordinates. */
    fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dx = x(lon2) - x(lon1)
        val dy = y(lat2) - y(lat1)
        return sqrt(dx * dx + dy * dy)
    }

    companion object {
        fun centeredOn(bounds: GeoBounds) = Projection(bounds.centerLat, bounds.centerLon)

        /** Analytic estimate of the worst relative error for points inside [bounds]. */
        fun worstCaseRelativeError(bounds: GeoBounds): Double {
            val halfHeight = Math.toRadians((bounds.maxLat - bounds.minLat) / 2)
            val worstLat = maxOf(abs(bounds.minLat), abs(bounds.maxLat))
            return tan(Math.toRadians(worstLat)) * halfHeight
        }
    }
}

/** Haversine great-circle distance, the reference the fast approximation is checked against. */
fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val p1 = Math.toRadians(lat1)
    val p2 = Math.toRadians(lat2)
    val dp = p2 - p1
    val dl = Math.toRadians(lon2 - lon1)
    val a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
    return 2 * EARTH_RADIUS_METERS * asin(minOf(1.0, sqrt(a)))
}
