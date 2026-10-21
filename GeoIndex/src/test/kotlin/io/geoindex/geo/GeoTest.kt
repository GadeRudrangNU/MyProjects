package io.geoindex.geo

import net.jqwik.api.ForAll
import net.jqwik.api.Property
import net.jqwik.api.constraints.DoubleRange
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import kotlin.math.abs
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class GeoTest {
    private val bounds = GeoBounds.NEW_YORK
    private val projection = Projection.centeredOn(bounds)

    /** The approximation stays within the documented bound for any two points in the default box. */
    @Property(tries = 2_000)
    fun approximationStaysWithinStatedErrorBound(
        @ForAll @DoubleRange(min = 40.55, max = 40.95) lat1: Double,
        @ForAll @DoubleRange(min = -74.30, max = -73.70) lon1: Double,
        @ForAll @DoubleRange(min = 40.55, max = 40.95) lat2: Double,
        @ForAll @DoubleRange(min = -74.30, max = -73.70) lon2: Double,
    ) {
        val exact = haversineMeters(lat1, lon1, lat2, lon2)
        if (exact < 1.0) return
        val approx = projection.distanceMeters(lat1, lon1, lat2, lon2)
        val relative = abs(approx - exact) / exact
        assertTrue(relative <= DISTANCE_ERROR_BOUND, "relative error $relative exceeds $DISTANCE_ERROR_BOUND")
    }

    @Test
    fun analyticEstimateCoversTheMeasuredWorstCase() {
        val estimate = Projection.worstCaseRelativeError(bounds)
        assertTrue(estimate <= DISTANCE_ERROR_BOUND, "default bounds must satisfy the stated bound")
        // The east-west corner-to-corner run is where the error peaks.
        val exact = haversineMeters(bounds.maxLat, bounds.minLon, bounds.maxLat, bounds.maxLon)
        val approx = projection.distanceMeters(bounds.maxLat, bounds.minLon, bounds.maxLat, bounds.maxLon)
        assertTrue(abs(approx - exact) / exact <= estimate * 1.05)
    }

    @Test
    fun projectionRoundTrips() {
        val lat = 40.7128
        val lon = -74.0060
        assertEquals(lat, projection.lat(projection.y(lat)), 1e-12)
        assertEquals(lon, projection.lon(projection.x(lon)), 1e-12)
        assertEquals(0.0, projection.x(bounds.centerLon), 1e-9)
        assertEquals(0.0, projection.y(bounds.centerLat), 1e-9)
    }

    @Test
    fun haversineKnownDistances() {
        assertEquals(0.0, haversineMeters(10.0, 20.0, 10.0, 20.0), 1e-9)
        // One degree of latitude is about 111.2 km.
        assertEquals(111_195.0, haversineMeters(0.0, 0.0, 1.0, 0.0), 50.0)
        // Times Square to the Empire State Building, about 1.07 km due south.
        assertEquals(1_070.0, haversineMeters(40.7580, -73.9855, 40.7484, -73.9857), 10.0)
    }

    @Test
    fun boundsContainmentAndValidation() {
        assertTrue(bounds.contains(40.7, -74.0))
        assertFalse(bounds.contains(41.5, -74.0))
        assertFalse(bounds.contains(40.7, -72.0))
        assertThrows<IllegalArgumentException> { GeoBounds(10.0, 10.0, 5.0, 20.0) }
        assertThrows<IllegalArgumentException> { GeoBounds(-95.0, 0.0, 10.0, 20.0) }
        assertThrows<IllegalArgumentException> { GeoBounds(0.0, -190.0, 10.0, 20.0) }
    }

    @Test
    fun errorEstimateGrowsWithLatitudeAndHeight() {
        val tall = GeoBounds(40.0, -74.0, 42.0, -73.0)
        assertTrue(Projection.worstCaseRelativeError(tall) > DISTANCE_ERROR_BOUND)
        val polar = GeoBounds(69.9, 10.0, 70.4, 10.5)
        assertTrue(Projection.worstCaseRelativeError(polar) > DISTANCE_ERROR_BOUND)
    }
}
