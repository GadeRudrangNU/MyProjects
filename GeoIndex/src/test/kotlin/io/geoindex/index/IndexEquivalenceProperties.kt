package io.geoindex.index

import net.jqwik.api.Arbitraries
import net.jqwik.api.Arbitrary
import net.jqwik.api.Combinators
import net.jqwik.api.ForAll
import net.jqwik.api.Property
import net.jqwik.api.Provide
import java.util.SplittableRandom
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The grid and the quadtree must agree exactly with the brute-force oracle on every query. */
class IndexEquivalenceProperties {
    data class Scenario(
        val seed: Long,
        val points: Int,
        val clustered: Boolean,
        val cellSize: Double,
        val leafCapacity: Int,
        val tiles: Int,
    )

    @Provide
    fun scenarios(): Arbitrary<Scenario> = Combinators.combine(
        Arbitraries.longs(),
        Arbitraries.integers().between(0, 400),
        Arbitraries.of(true, false),
        Arbitraries.doubles().between(20.0, 3_000.0),
        Arbitraries.integers().between(1, 40),
        Arbitraries.integers().between(1, 6),
    ).`as` { seed, points, clustered, cell, leaf, tiles -> Scenario(seed, points, clustered, cell, leaf, tiles) }

    private fun candidates(s: Scenario): List<Pair<String, SpatialIndex>> = listOf(
        "grid" to GridIndex(TEST_PLANE, s.cellSize, stripeCount = 8),
        "quadtree" to QuadTreeIndex(TEST_PLANE, s.leafCapacity, s.tiles),
    )

    private fun filled(s: Scenario, items: List<Item>): Pair<BruteForceIndex, List<Pair<String, SpatialIndex>>> {
        val brute = BruteForceIndex()
        val others = candidates(s)
        for (item in items) {
            brute.upsert(item)
            others.forEach { it.second.upsert(item) }
        }
        return brute to others
    }

    @Property(tries = 300)
    fun nearestMatchesBruteForce(@ForAll("scenarios") s: Scenario) {
        val rng = SplittableRandom(s.seed)
        val (brute, others) = filled(s, randomItems(rng, s.points, s.clustered))
        repeat(20) {
            // Queries land inside the plane, in its margin and far outside it.
            val q = TEST_PLANE.randomPoint(rng, margin = if (it % 4 == 0) 20_000.0 else 0.0)
            val k = 1 + rng.nextInt(60)
            val expected = brute.nearest(q[0], q[1], k)
            for ((name, index) in others) assertSameNeighbors(expected, index.nearest(q[0], q[1], k), "$name k=$k q=${q.toList()}")
        }
    }

    @Property(tries = 300)
    fun withinRadiusMatchesBruteForce(@ForAll("scenarios") s: Scenario) {
        val rng = SplittableRandom(s.seed)
        val (brute, others) = filled(s, randomItems(rng, s.points, s.clustered))
        repeat(20) {
            val q = TEST_PLANE.randomPoint(rng, margin = if (it % 4 == 0) 3_000.0 else 0.0)
            val radius = if (it % 5 == 0) 0.0 else rng.nextDouble(0.0, 4_000.0)
            val expected = brute.withinRadius(q[0], q[1], radius)
            for ((name, index) in others) {
                assertSameNeighbors(expected, index.withinRadius(q[0], q[1], radius), "$name r=$radius q=${q.toList()}")
            }
        }
    }

    @Property(tries = 150)
    fun stayEquivalentThroughMovesAndRemovals(@ForAll("scenarios") s: Scenario) {
        val rng = SplittableRandom(s.seed)
        val brute = BruteForceIndex()
        val others = candidates(s)
        val all = listOf("brute" to brute as SpatialIndex) + others
        val pool = (s.points / 4).coerceIn(5, 80)
        var clock = 1_000L

        repeat(300) { step ->
            val id = "e${rng.nextInt(pool)}"
            val op = rng.nextInt(10)
            if (op < 7) {
                val p = randomItems(rng, 1, s.clustered)[0]
                // Occasionally replay an older timestamp, which every index must ignore.
                val ts = if (op == 0) clock - 500 else ++clock
                val item = Item(id, p.x, p.y, ts)
                val results = all.map { it.second.upsert(item) }
                assertTrue(results.all { it.applied == results[0].applied }, "indexes disagree on whether the update applied")
            } else {
                val results = all.map { it.second.remove(id)?.id }
                assertTrue(results.all { it == results[0] }, "indexes disagree on removal")
            }
            if (step % 25 == 0) {
                val q = TEST_PLANE.randomPoint(rng)
                val expected = brute.nearest(q[0], q[1], 12)
                for ((name, index) in others) assertSameNeighbors(expected, index.nearest(q[0], q[1], 12), name)
                val within = brute.withinRadius(q[0], q[1], 1_500.0)
                for ((name, index) in others) assertSameNeighbors(within, index.withinRadius(q[0], q[1], 1_500.0), name)
            }
        }
        for ((name, index) in others) {
            assertEquals(brute.size, index.size, "$name size")
            assertEquals(
                brute.snapshot().associate { it.id to it.ts },
                index.snapshot().associate { it.id to it.ts },
                "$name contents",
            )
        }
    }

    @Property(tries = 100)
    fun removingEverythingLeavesAnEmptyIndex(@ForAll("scenarios") s: Scenario) {
        val rng = SplittableRandom(s.seed)
        val items = randomItems(rng, s.points, s.clustered)
        val (_, others) = filled(s, items)
        for ((name, index) in others) {
            assertEquals(items.size, index.size, name)
            items.shuffled(java.util.Random(s.seed)).forEach { assertEquals(it.id, index.remove(it.id)?.id, name) }
            assertEquals(0, index.size, name)
            assertTrue(index.nearest(0.0, 0.0, 10).isEmpty(), "$name nearest on empty")
            assertTrue(index.withinRadius(0.0, 0.0, 1e9).isEmpty(), "$name within on empty")
            assertTrue(index.snapshot().isEmpty(), name)
            if (index is QuadTreeIndex) assertEquals(s.tiles * s.tiles, index.leafCount(), "tree must collapse back to its roots")
        }
    }
}
