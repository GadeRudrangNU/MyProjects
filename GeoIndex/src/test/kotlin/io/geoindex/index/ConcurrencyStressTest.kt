package io.geoindex.index

import org.junit.jupiter.api.Timeout
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.util.SplittableRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Many writers and readers hammer one index. While writers run, every read must be internally
 * consistent; once they stop, the index must hold exactly what was written.
 */
class ConcurrencyStressTest {
    private fun create(kind: String): SpatialIndex = when (kind) {
        "grid" -> GridIndex(TEST_PLANE, 150.0, 16)
        "quadtree" -> QuadTreeIndex(TEST_PLANE, 8, 4)
        else -> BruteForceIndex()
    }

    private fun positionFor(id: Int, round: Int): DoubleArray {
        val rng = SplittableRandom(id * 1_000_003L + round)
        return TEST_PLANE.randomPoint(rng)
    }

    @ParameterizedTest
    @ValueSource(strings = ["grid", "quadtree", "brute"])
    @Timeout(120)
    fun writersAndReadersEndWithExactlyWhatWasWritten(kind: String) {
        val index = create(kind)
        val writers = 6
        val idsPerWriter = 400
        val rounds = 25
        val readers = 4

        // Entities that never move: a reader asking from their exact spot must always find them.
        val stable = List(50) { Item("stable$it", TEST_PLANE.minX + 100 + it * 200.0, TEST_PLANE.minY + 500.0, 1) }
        stable.forEach { index.upsert(it) }

        val done = AtomicBoolean(false)
        val failures = ConcurrentHashMap.newKeySet<String>()
        val readOps = AtomicLong()
        val pool = Executors.newFixedThreadPool(writers + readers)
        val start = CountDownLatch(1)

        val writerFutures = (0 until writers).map { w ->
            pool.submit {
                start.await()
                for (round in 1..rounds) {
                    for (i in 0 until idsPerWriter) {
                        val id = w * idsPerWriter + i
                        val p = positionFor(id, round)
                        index.upsert(Item("m$id", p[0], p[1], round.toLong()))
                    }
                }
                // Each writer then deletes every fifth of its entities.
                for (i in 0 until idsPerWriter step 5) index.remove("m${w * idsPerWriter + i}")
            }
        }

        val readerFutures = (0 until readers).map { r ->
            pool.submit {
                val rng = SplittableRandom(r.toLong())
                start.await()
                while (!done.get()) {
                    val q = TEST_PLANE.randomPoint(rng)
                    val hits = index.nearest(q[0], q[1], 20)
                    checkWellFormed(hits, failures)
                    checkWellFormed(index.withinRadius(q[0], q[1], 600.0), failures)
                    val s = stable[rng.nextInt(stable.size)]
                    val exact = index.nearest(s.x, s.y, 1)
                    if (exact.isEmpty() || exact[0].item.id != s.id || exact[0].distance != 0.0) {
                        failures.add("stable entity ${s.id} was missed while writers were active")
                    }
                    readOps.incrementAndGet()
                }
            }
        }

        start.countDown()
        writerFutures.forEach { it.get(100, TimeUnit.SECONDS) }
        done.set(true)
        readerFutures.forEach { it.get(30, TimeUnit.SECONDS) }
        pool.shutdown()

        assertTrue(failures.isEmpty(), "read anomalies: ${failures.take(5)}")
        assertTrue(readOps.get() > 0, "readers never ran")

        val expected = HashMap<String, DoubleArray>()
        for (w in 0 until writers) for (i in 0 until idsPerWriter) {
            if (i % 5 == 0) continue
            val id = w * idsPerWriter + i
            expected["m$id"] = positionFor(id, rounds)
        }
        stable.forEach { expected[it.id] = doubleArrayOf(it.x, it.y) }

        assertEquals(expected.size, index.size)
        val actual = index.snapshot().associateBy { it.id }
        assertEquals(expected.keys, actual.keys)
        for ((id, p) in expected) {
            val item = assertNotNull(actual[id])
            assertEquals(p[0], item.x, id)
            assertEquals(p[1], item.y, id)
            assertEquals(p[0], assertNotNull(index[id]).x, id)
        }
        assertEquals(expected.size, index.withinRadius(0.0, 0.0, 1e9).size)
        // Every surviving entity is reachable by a spatial query at its own position.
        for ((id, p) in expected.entries.take(300)) {
            assertEquals(id, index.nearest(p[0], p[1], 1)[0].item.id)
        }
    }

    @ParameterizedTest
    @ValueSource(strings = ["grid", "quadtree"])
    @Timeout(120)
    fun competingWritersOnTheSameIdsLeaveTheNewestReport(kind: String) {
        val index = create(kind)
        val ids = 200
        val writers = 8
        val perWriter = 3_000
        val clock = AtomicLong()
        val newest = Array(ids) { AtomicLong(0) }
        val pool = Executors.newFixedThreadPool(writers)
        val start = CountDownLatch(1)

        val futures = (0 until writers).map { w ->
            pool.submit {
                val rng = SplittableRandom(w.toLong())
                start.await()
                repeat(perWriter) {
                    val id = rng.nextInt(ids)
                    val ts = clock.incrementAndGet()
                    val p = positionFor(id, ts.toInt())
                    index.upsert(Item("c$id", p[0], p[1], ts))
                    newest[id].accumulateAndGet(ts, ::maxOf)
                }
            }
        }
        start.countDown()
        futures.forEach { it.get(100, TimeUnit.SECONDS) }
        pool.shutdown()

        for (id in 0 until ids) {
            val last = newest[id].get()
            if (last == 0L) continue
            val item = assertNotNull(index["c$id"])
            assertEquals(last, item.ts, "id $id must hold its newest report")
            val p = positionFor(id, last.toInt())
            assertEquals(p[0], item.x)
            assertEquals(p[1], item.y)
            assertEquals("c$id", index.nearest(item.x, item.y, 1)[0].item.id)
        }
        val present = (0 until ids).count { newest[it].get() != 0L }
        assertEquals(present, index.size)
        assertEquals(present, index.withinRadius(0.0, 0.0, 1e9).size)
    }

    private fun checkWellFormed(hits: List<Neighbor>, failures: MutableSet<String>) {
        val seen = HashSet<String>()
        var previous = -1.0
        for (h in hits) {
            if (!seen.add(h.item.id)) failures.add("duplicate id ${h.item.id} in one result")
            if (h.distance < previous) failures.add("results are not ordered by distance")
            previous = h.distance
        }
    }
}
