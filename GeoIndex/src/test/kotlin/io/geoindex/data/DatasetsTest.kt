package io.geoindex.data

import io.geoindex.geo.GeoBounds
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.util.SplittableRandom
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DatasetsTest {
    private val bounds = GeoBounds.NEW_YORK

    @Test
    fun syntheticDataIsDeterministicAndInsideTheBounds() {
        val a = SyntheticCity(bounds, seed = 7).positions(2_000)
        val b = SyntheticCity(bounds, seed = 7).positions(2_000)
        val c = SyntheticCity(bounds, seed = 8).positions(2_000)
        assertEquals(a.map { it.lat to it.lon }, b.map { it.lat to it.lon })
        assertTrue(a.map { it.lat to it.lon } != c.map { it.lat to it.lon })
        assertTrue(a.all { bounds.contains(it.lat, it.lon) })
    }

    @Test
    fun syntheticDataIsClusteredNotUniform() {
        val points = SyntheticCity(bounds, seed = 42).positions(50_000)
        // Bin into a 20x20 grid: a uniform spread would put about 125 points in each bin.
        val bins = IntArray(400)
        for (p in points) {
            val bx = ((p.lon - bounds.minLon) / (bounds.maxLon - bounds.minLon) * 20).toInt().coerceIn(0, 19)
            val by = ((p.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat) * 20).toInt().coerceIn(0, 19)
            bins[by * 20 + bx]++
        }
        assertTrue(bins.max() > 125 * 6, "densest bin holds ${bins.max()} points; expected strong clustering")
        assertTrue(bins.count { it < 125 / 3 } > 100, "expected many sparse bins")
    }

    @Test
    fun randomWalkStepsStayInBoundsAndMoveByRoughlyTheStepSize() {
        val city = SyntheticCity(bounds)
        val rng = SplittableRandom(1)
        var p = LatLon(bounds.minLat, bounds.minLon)   // start in a corner so clamping is exercised
        repeat(500) {
            val next = city.step(p, rng, 100.0)
            assertTrue(bounds.contains(next.lat, next.lon))
            p = next
        }
        val q = city.querySample(rng)
        assertTrue(bounds.contains(q.lat, q.lon))
    }

    @Test
    fun randomWalkersBounceOffTheEdgeInsteadOfPilingUpOnIt() {
        val city = SyntheticCity(bounds)
        val rng = SplittableRandom(9)
        val walkers = Array(2_000) { LatLon(bounds.maxLat - 0.0002, bounds.centerLon) }
        repeat(50) { for (i in walkers.indices) walkers[i] = city.step(walkers[i], rng, 60.0) }
        val pinned = walkers.count { it.lat == bounds.maxLat }
        assertTrue(pinned < 20, "$pinned walkers are stuck exactly on the boundary")
        assertTrue(walkers.all { bounds.contains(it.lat, it.lon) })
    }

    @Test
    fun csvLoaderReadsRealCoordinatesAndSkipsBadRows(@TempDir dir: File) {
        val file = File(dir, "pickups.csv")
        file.writeText(
            """
            id,pickup_latitude,pickup_longitude,fare
            1,40.7580,-73.9855,12.5
            2,40.6892,-74.0445,8.0
            3,0,0,3.0
            4,not-a-number,-73.9,1.0
            5,40.7484,-73.9857,9.9
            6,"40.8000","-73.9500",4.2
            """.trimIndent(),
        )
        val data = CsvDataset(file, bounds)
        assertEquals(4, data.rowCount)
        assertEquals(2, data.positions(2).size)
        val padded = data.positions(10)
        assertEquals(10, padded.size)
        assertTrue(padded.all { bounds.contains(it.lat, it.lon) })
        val rng = SplittableRandom(3)
        assertTrue(bounds.contains(data.querySample(rng).lat, data.querySample(rng).lon))
        val moved = data.step(LatLon(40.75, -73.98), rng, 50.0)
        assertTrue(bounds.contains(moved.lat, moved.lon))
    }

    @Test
    fun csvLoaderHonoursExplicitColumnsAndRejectsUnusableFiles(@TempDir dir: File) {
        val named = File(dir, "named.csv").apply { writeText("y,x\n40.7,-74.0\n40.8,-73.9\n") }
        assertEquals(2, CsvDataset(named, bounds, latColumn = "y", lonColumn = "x").rowCount)
        assertThrows<IllegalArgumentException> { CsvDataset(named, bounds) }

        val outside = File(dir, "outside.csv").apply { writeText("lat,lon\n10,10\n") }
        assertThrows<IllegalArgumentException> { CsvDataset(outside, bounds) }
        val empty = File(dir, "empty.csv").apply { writeText("") }
        assertThrows<IllegalArgumentException> { CsvDataset(empty, bounds) }
    }
}
