package io.geoindex.service

import io.geoindex.index.BruteForceIndex
import io.geoindex.index.Item
import org.junit.jupiter.api.Test
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExpiryAndMetricsTest {
    @Test
    fun sweepExpiresOnlyEntitiesAtOrBeforeTheCutoff() {
        val index = BruteForceIndex()
        val queue = ExpiryQueue()
        listOf(100L, 200L, 300L).forEachIndexed { i, ts ->
            index.upsert(Item("e$i", 0.0, 0.0, ts))
            queue.track("e$i", ts)
        }
        val expired = ArrayList<String>()
        assertEquals(2, queue.sweep(index, cutoff = 200) { expired.add(it.id) })
        assertEquals(listOf("e0", "e1"), expired)
        assertEquals(1, queue.size)
        assertEquals(1, index.size)
    }

    @Test
    fun entriesForEntitiesRemovedByHandAreDroppedLazily() {
        val index = BruteForceIndex()
        val queue = ExpiryQueue()
        index.upsert(Item("gone", 0.0, 0.0, 10))
        queue.track("gone", 10)
        index.remove("gone")
        assertEquals(1, queue.size, "removal does not touch the heap")
        assertEquals(0, queue.sweep(index, cutoff = 1_000) { error("nothing should expire") })
        assertEquals(0, queue.size)
    }

    @Test
    fun aRereportedEntityIsRequeuedAtItsNewTimeInsteadOfExpiring() {
        val index = BruteForceIndex()
        val queue = ExpiryQueue()
        index.upsert(Item("x", 0.0, 0.0, 10))
        queue.track("x", 10)
        index.upsert(Item("x", 1.0, 1.0, 500))
        assertEquals(0, queue.sweep(index, cutoff = 100) { error("x is still alive") })
        assertEquals(1, queue.size)
        assertEquals(1, queue.sweep(index, cutoff = 500) { })
        assertEquals(0, index.size)
    }

    @Test
    fun aSweepStopsAtItsPopLimit() {
        val index = BruteForceIndex()
        val queue = ExpiryQueue()
        repeat(10) {
            index.upsert(Item("e$it", 0.0, 0.0, it.toLong()))
            queue.track("e$it", it.toLong())
        }
        assertEquals(3, queue.sweep(index, cutoff = 1_000, limit = 3) { })
        assertEquals(7, index.size)
        assertEquals(7, queue.sweep(index, cutoff = 1_000) { })
    }

    @Test
    fun anEntityThatReportsDuringTheRemovalRaceSurvives() {
        // The index reports the entity as stale when the sweeper looks, then it re-reports
        // before the guarded removal runs.
        val inner = BruteForceIndex()
        val racing = object : io.geoindex.index.SpatialIndex by inner {
            private var first = true
            override fun get(id: String): Item? {
                val seen = inner[id]
                if (first && seen != null) {
                    first = false
                    inner.upsert(Item(id, 5.0, 5.0, 900))
                }
                return seen
            }
        }
        val queue = ExpiryQueue()
        inner.upsert(Item("x", 0.0, 0.0, 10))
        queue.track("x", 10)
        assertEquals(0, queue.sweep(racing, cutoff = 100) { error("must not expire") })
        assertEquals(1, inner.size)
        assertEquals(1, queue.size, "the survivor is tracked again at its new time")
        assertEquals(900L, inner["x"]!!.ts)
    }

    @Test
    fun latencyPercentilesComeFromARecordedDistribution() {
        val metrics = ServiceMetrics()
        repeat(990) { metrics.nearestLatency.record(100, TimeUnit.MICROSECONDS) }
        repeat(10) { metrics.nearestLatency.record(50, TimeUnit.MILLISECONDS) }
        val stats = ServiceMetrics.latencyOf(metrics.nearestLatency)
        assertEquals(1_000L, stats.count)
        assertEquals(0.1, stats.p50Ms, 0.02)
        assertEquals(0.1, stats.p95Ms, 0.02)
        assertTrue(stats.p99Ms in 0.08..60.0)
        assertEquals(50.0, stats.maxMs, 0.01)
        assertTrue(stats.meanMs > stats.p50Ms)
    }

    @Test
    fun throughputIsTheTrailingAverageRate() {
        var updates = 0L
        var nearest = 0L
        var within = 0L
        val window = ThroughputWindow({ updates }, { nearest }, { within }, samples = 3)
        assertEquals(0.0, window.rates().updatesPerSecond)
        val second = 1_000_000_000L
        window.sample(0)
        updates = 1_000; nearest = 200; within = 50
        window.sample(second)
        updates = 3_000; nearest = 600; within = 150
        window.sample(2 * second)
        val r = window.rates()
        assertEquals(1_500.0, r.updatesPerSecond, 1e-6)
        assertEquals(300.0, r.nearestPerSecond, 1e-6)
        assertEquals(75.0, r.withinPerSecond, 1e-6)
        window.sample(2 * second)
        assertEquals(1_500.0, window.rates().updatesPerSecond, 1e-6, "zero elapsed time must not divide by zero")
    }
}
