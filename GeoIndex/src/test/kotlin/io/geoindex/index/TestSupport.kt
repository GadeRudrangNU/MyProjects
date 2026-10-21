package io.geoindex.index

import java.util.SplittableRandom
import kotlin.test.assertEquals

val TEST_PLANE = Rect(-5_000.0, -4_000.0, 6_000.0, 5_000.0)

/** Points either uniform over the plane or packed into a few tight clumps with exact duplicates. */
fun randomItems(rng: SplittableRandom, n: Int, clustered: Boolean, plane: Rect = TEST_PLANE): List<Item> {
    val centers = List(4) { doubleArrayOf(rng.nextDouble(plane.minX, plane.maxX), rng.nextDouble(plane.minY, plane.maxY)) }
    return List(n) { i ->
        val x: Double
        val y: Double
        if (clustered) {
            val c = centers[rng.nextInt(centers.size)]
            // Quantising to a coarse step creates many exact duplicates and distance ties.
            x = (c[0] + Math.round(rng.nextGaussian() * 40) * 0.5).coerceIn(plane.minX, plane.maxX)
            y = (c[1] + Math.round(rng.nextGaussian() * 40) * 0.5).coerceIn(plane.minY, plane.maxY)
        } else {
            x = rng.nextDouble(plane.minX, plane.maxX)
            y = rng.nextDouble(plane.minY, plane.maxY)
        }
        Item("e$i", x, y, 1_000L + i)
    }
}

fun assertSameNeighbors(expected: List<Neighbor>, actual: List<Neighbor>, context: String = "") {
    assertEquals(expected.map { it.item.id }, actual.map { it.item.id }, "ids differ $context")
    assertEquals(expected.map { it.distance }, actual.map { it.distance }, "distances differ $context")
}

fun Rect.randomPoint(rng: SplittableRandom, margin: Double = 0.0): DoubleArray =
    doubleArrayOf(rng.nextDouble(minX - margin, maxX + margin), rng.nextDouble(minY - margin, maxY + margin))
