package io.geoindex.index

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.util.SplittableRandom
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

class IndexBehaviorTest {
    private fun everyIndex(): List<Pair<String, SpatialIndex>> = listOf(
        "brute" to BruteForceIndex(),
        "grid" to GridIndex(TEST_PLANE, 200.0, 8),
        "quadtree" to QuadTreeIndex(TEST_PLANE, 4, 3),
    )

    @Test
    fun nearestOrdersByDistanceThenId() {
        for ((name, index) in everyIndex()) {
            index.upsert(Item("b", 10.0, 0.0, 1))
            index.upsert(Item("a", -10.0, 0.0, 1))
            index.upsert(Item("c", 3.0, 0.0, 1))
            val hits = index.nearest(0.0, 0.0, 3)
            assertEquals(listOf("c", "a", "b"), hits.map { it.item.id }, name)
            assertEquals(3.0, hits[0].distance, 1e-12, name)
        }
    }

    @Test
    fun kLargerThanSizeReturnsEverything() {
        for ((name, index) in everyIndex()) {
            index.upsert(Item("one", 1.0, 1.0, 1))
            index.upsert(Item("two", 2.0, 2.0, 1))
            assertEquals(2, index.nearest(0.0, 0.0, 50).size, name)
            assertTrue(index.nearest(0.0, 0.0, 0).isEmpty(), name)
            assertTrue(index.nearest(0.0, 0.0, -3).isEmpty(), name)
        }
    }

    @Test
    fun emptyIndexAnswersQueriesWithNothing() {
        for ((name, index) in everyIndex()) {
            assertEquals(0, index.size, name)
            assertTrue(index.nearest(0.0, 0.0, 5).isEmpty(), name)
            assertTrue(index.withinRadius(0.0, 0.0, 1_000.0).isEmpty(), name)
            assertNull(index["nope"], name)
            assertNull(index.remove("nope"), name)
        }
    }

    @Test
    fun upsertMovesAnEntityAndReportsThePreviousPosition() {
        for ((name, index) in everyIndex()) {
            val first = Item("x", 100.0, 100.0, 1)
            val r1 = index.upsert(first)
            assertTrue(r1.applied, name)
            assertNull(r1.previous, name)
            val second = Item("x", -900.0, 700.0, 2)
            val r2 = index.upsert(second)
            assertTrue(r2.applied, name)
            assertSame(first, r2.previous, name)
            assertEquals(1, index.size, name)
            assertSame(second, index["x"], name)
            assertTrue(index.withinRadius(100.0, 100.0, 50.0).isEmpty(), "$name still found at the old position")
            assertEquals(listOf("x"), index.withinRadius(-900.0, 700.0, 1.0).map { it.item.id }, name)
        }
    }

    @Test
    fun olderReportsAreIgnored() {
        for ((name, index) in everyIndex()) {
            val current = Item("x", 5.0, 5.0, 100)
            index.upsert(current)
            val stale = index.upsert(Item("x", 900.0, 900.0, 99))
            assertFalse(stale.applied, name)
            assertSame(current, stale.previous, name)
            assertSame(current, index["x"], name)
            // Equal timestamps are accepted: the later arrival wins.
            assertTrue(index.upsert(Item("x", 6.0, 6.0, 100)).applied, name)
        }
    }

    @Test
    fun removeHonoursTheTimestampGuard() {
        for ((name, index) in everyIndex()) {
            index.upsert(Item("x", 5.0, 5.0, 100))
            assertNull(index.remove("x", maxTs = 99), "$name must keep an entity newer than the guard")
            assertEquals(1, index.size, name)
            assertNotNull(index.remove("x", maxTs = 100), name)
            assertEquals(0, index.size, name)
        }
    }

    @Test
    fun pointsOutsideTheBoundsAreRejected() {
        for ((name, index) in everyIndex().filter { it.first != "brute" }) {
            assertThrows<IllegalArgumentException>(name) { index.upsert(Item("far", 1e7, 0.0, 1)) }
            assertEquals(0, index.size, name)
        }
    }

    @Test
    fun pointsOnTheBoundaryAreIndexed() {
        for ((name, index) in everyIndex()) {
            val corners = listOf(
                TEST_PLANE.minX to TEST_PLANE.minY, TEST_PLANE.maxX to TEST_PLANE.maxY,
                TEST_PLANE.minX to TEST_PLANE.maxY, TEST_PLANE.maxX to TEST_PLANE.minY,
            )
            corners.forEachIndexed { i, (x, y) -> index.upsert(Item("c$i", x, y, 1)) }
            for ((i, c) in corners.withIndex()) {
                assertEquals("c$i", index.nearest(c.first, c.second, 1)[0].item.id, name)
            }
        }
    }

    @Test
    fun clearEmptiesTheIndex() {
        for ((name, index) in everyIndex()) {
            randomItems(SplittableRandom(1), 200, clustered = false).forEach { index.upsert(it) }
            index.clear()
            assertEquals(0, index.size, name)
            assertTrue(index.nearest(0.0, 0.0, 5).isEmpty(), name)
        }
    }

    @Test
    fun withinRadiusIncludesThePointsExactlyOnTheBoundary() {
        for ((name, index) in everyIndex()) {
            index.upsert(Item("edge", 30.0, 40.0, 1))
            assertEquals(1, index.withinRadius(0.0, 0.0, 50.0).size, name)
            assertEquals(0, index.withinRadius(0.0, 0.0, 49.999).size, name)
            assertTrue(index.withinRadius(0.0, 0.0, -1.0).isEmpty(), name)
        }
    }

    @Test
    fun quadtreeStaysBoundedWhenManyPointsCoincide() {
        val tree = QuadTreeIndex(TEST_PLANE, leafCapacity = 4, tilesPerSide = 2, maxDepth = 12)
        repeat(500) { tree.upsert(Item("dup$it", 123.0, 456.0, 1)) }
        assertEquals(500, tree.size)
        assertTrue(tree.maxObservedDepth() <= 12)
        assertEquals(10, tree.nearest(123.0, 456.0, 10).size)
        assertEquals(500, tree.withinRadius(123.0, 456.0, 0.0).size)
    }

    @Test
    fun quadtreeSplitsCrowdedAreasAndMergesThemBack() {
        val tree = QuadTreeIndex(TEST_PLANE, leafCapacity = 8, tilesPerSide = 1)
        val items = randomItems(SplittableRandom(3), 400, clustered = true)
        items.forEach { tree.upsert(it) }
        assertTrue(tree.leafCount() > 1)
        assertTrue(tree.maxObservedDepth() > 1)
        items.forEach { tree.remove(it.id) }
        assertEquals(1, tree.leafCount())
        assertEquals(0, tree.maxObservedDepth())
    }

    @Test
    fun constructorsValidateTheirArguments() {
        assertThrows<IllegalArgumentException> { GridIndex(TEST_PLANE, 0.0) }
        assertThrows<IllegalArgumentException> { GridIndex(TEST_PLANE, 100.0, stripeCount = 3) }
        assertThrows<IllegalArgumentException> { GridIndex(TEST_PLANE, 0.0001) }
        assertThrows<IllegalArgumentException> { QuadTreeIndex(TEST_PLANE, leafCapacity = 0) }
        assertThrows<IllegalArgumentException> { QuadTreeIndex(TEST_PLANE, tilesPerSide = 0) }
        assertThrows<IllegalArgumentException> { Rect(1.0, 0.0, 1.0, 5.0) }
    }

    @Test
    fun gridHandlesACellSizeLargerThanTheWholePlane() {
        val grid = GridIndex(TEST_PLANE, 1e6, 1)
        randomItems(SplittableRandom(5), 100, clustered = false).forEach { grid.upsert(it) }
        assertEquals(100, grid.nearest(0.0, 0.0, 500).size)
    }

    @Test
    fun rankedNeighborsKeepsTheNewestCopyOfADuplicatedId() {
        val old = Item("x", 1.0, 0.0, 1)
        val new = Item("x", 2.0, 0.0, 2)
        val other = Item("y", 3.0, 0.0, 1)
        val ranked = rankedNeighbors(listOf(Neighbor(old, 1.0), Neighbor(other, 3.0), Neighbor(new, 2.0)))
        assertEquals(listOf("x", "y"), ranked.map { it.item.id })
        assertSame(new, ranked[0].item)
    }
}
