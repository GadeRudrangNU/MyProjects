package io.geoindex.service

import io.geoindex.geo.haversineMeters
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.util.concurrent.atomic.AtomicLong
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FakeClock(start: Long = 1_700_000_000_000L) : Clock {
    private val now = AtomicLong(start)
    override fun nowMillis(): Long = now.get()
    fun advance(millis: Long) = now.addAndGet(millis)
}

class GeoServiceTest {
    private val clock = FakeClock()
    private val services = ArrayList<GeoService>()

    private fun service(config: ServiceConfig = ServiceConfig(ttlMillis = 10_000, ingestWorkers = 2)): GeoService =
        GeoService(config, clock).also { services.add(it) }

    @AfterEach
    fun shutDown() = services.forEach { it.close() }

    private fun update(id: String, lat: Double = 40.75, lon: Double = -73.99, ts: Long? = null) = PositionUpdate(id, lat, lon, ts)

    @Test
    fun invalidUpdatesAreRejectedWithAReason() {
        val s = service()
        val result = s.submit(
            listOf(
                update("ok"),
                update("", 40.7, -74.0),
                update("nan", Double.NaN, -74.0),
                update("far", 10.0, 10.0),
                update("future", ts = clock.nowMillis() + 3_600_000),
                update("ancient", ts = clock.nowMillis() - 3_600_000),
            ),
        )
        val accepted = assertIs<SubmitResult.Accepted>(result)
        assertEquals(1, accepted.accepted)
        assertEquals(5, accepted.rejected)
        assertNotNull(accepted.firstError)
        assertEquals(5.0, s.metrics.updatesRejected.count())
    }

    @Test
    fun batchesLargerThanTheLimitAreRefused() {
        val s = service(ServiceConfig(maxBatchSize = 2, ingestWorkers = 0))
        assertThrows<IllegalArgumentException> { s.submit(List(3) { update("e$it") }) }
    }

    @Test
    fun aFullyInvalidBatchIsNotQueued() {
        val s = service()
        val r = assertIs<SubmitResult.Accepted>(s.submit(listOf(update("far", 0.0, 0.0))))
        assertEquals(0, r.accepted)
        assertEquals(0, s.queueDepth)
    }

    @Test
    fun acceptedUpdatesBecomeQueryableAndDistancesAreAccurate() {
        val s = service().start()
        s.submit(listOf(update("a", 40.7580, -73.9855), update("b", 40.6892, -74.0445), update("c", 40.8000, -73.9500)))
        assertTrue(s.awaitIdle())
        assertEquals(3, s.index.size)

        val hits = s.nearest(40.7484, -73.9857, 2)
        assertEquals(listOf("a", "c"), hits.map { it.id })
        val exact = haversineMeters(40.7484, -73.9857, 40.7580, -73.9855)
        assertEquals(exact, hits[0].distanceMeters!!, exact * 0.005)
        assertEquals(40.7580, hits[0].lat, 1e-9)
        assertEquals(-73.9855, hits[0].lon, 1e-9)

        val within = s.within(40.7484, -73.9857, 2_000.0)
        assertEquals(listOf("a"), within.hits.map { it.id })
        assertFalse(within.truncated)
    }

    @Test
    fun withinReportsTruncationAndTheFullCount() {
        val s = service()
        repeat(10) { s.apply(s.toItem(update("e$it", 40.75 + it * 0.0001, -73.99, clock.nowMillis()))) }
        val range = s.within(40.75, -73.99, 5_000.0, limit = 4)
        assertEquals(4, range.hits.size)
        assertEquals(10, range.total)
        assertTrue(range.truncated)
        assertEquals("e0", range.hits[0].id)
    }

    @Test
    fun staleReportsAreCountedAndIgnored() {
        val s = service()
        val t = clock.nowMillis()
        s.apply(s.toItem(update("x", 40.70, -74.00, t)))
        s.apply(s.toItem(update("x", 40.90, -73.80, t - 1_000)))
        assertEquals(1.0, s.metrics.updatesStale.count())
        assertEquals(40.70, s.get("x")!!.lat, 1e-9)
    }

    @Test
    fun fullQueueAnswersQueueFullAndRecoversOnceDrained() {
        val s = service(ServiceConfig(queueCapacity = 3, ingestWorkers = 0))
        repeat(3) { assertIs<SubmitResult.Accepted>(s.submit(listOf(update("e$it")))) }
        val full = assertIs<SubmitResult.QueueFull>(s.submit(listOf(update("overflow"))))
        assertEquals(3, full.queueDepth)
        assertEquals(3, full.capacity)
        assertEquals(1.0, s.metrics.batchesRejected.count())
        assertEquals(3, s.queueDepth)
        assertNull(s.get("overflow"))

        s.startIngestWorkers(2)
        assertTrue(s.awaitIdle(), "queue should drain once workers run")
        assertEquals(0, s.queueDepth)
        assertEquals(3, s.index.size)
        assertIs<SubmitResult.Accepted>(s.submit(listOf(update("after"))))
        assertTrue(s.awaitIdle())
        assertNotNull(s.get("after"))
    }

    @Test
    fun silentEntitiesExpireAndReportingKeepsThemAlive() {
        val s = service()
        val t0 = clock.nowMillis()
        s.apply(s.toItem(update("quiet", ts = t0)))
        s.apply(s.toItem(update("chatty", ts = t0)))

        clock.advance(6_000)
        s.apply(s.toItem(update("chatty", ts = clock.nowMillis())))
        assertEquals(0, s.expireNow())

        clock.advance(6_000)  // quiet is now 12 s old, chatty only 6 s
        assertEquals(1, s.expireNow())
        assertNull(s.get("quiet"))
        assertNotNull(s.get("chatty"))
        assertEquals(1.0, s.metrics.entitiesExpired.count())

        clock.advance(5_000)  // chatty is 11 s old
        assertEquals(1, s.expireNow())
        assertEquals(0, s.index.size)
    }

    @Test
    fun theExpiryHeapHoldsOneEntryPerEntityNoMatterHowOftenTheyReport() {
        val s = service(ServiceConfig(ttlMillis = 1_000_000))
        repeat(100) { s.apply(s.toItem(update("e$it", ts = clock.nowMillis()))) }
        repeat(50) {
            clock.advance(100)
            repeat(100) { i -> s.apply(s.toItem(update("e$i", ts = clock.nowMillis()))) }
        }
        assertEquals(100, s.snapshot().expiryHeapSize)
    }

    @Test
    fun zoneEventsFireOnEnterExitAndForNewAndRemovedEntities() {
        val s = service()
        s.zones.put(Zone("zone", "Midtown", 40.7580, -73.9855, 500.0))
        s.zones.put(Zone("other", "Elsewhere", 40.60, -74.10, 300.0))
        val all = s.events.subscribe()
        val onlyZone = s.events.subscribe("zone")
        val onlyOther = s.events.subscribe("other")
        val t = clock.nowMillis()

        s.apply(s.toItem(update("car", 40.7000, -73.9855, t)))            // outside, new
        assertNull(all.events.tryReceive().getOrNull())
        s.apply(s.toItem(update("car", 40.7580, -73.9855, t + 1)))        // enters
        s.apply(s.toItem(update("car", 40.7581, -73.9855, t + 2)))        // moves inside: no event
        s.apply(s.toItem(update("car", 40.7000, -73.9855, t + 3)))        // exits
        s.apply(s.toItem(update("van", 40.7580, -73.9855, t + 4)))        // appears inside: enter
        s.remove("van")                                                    // removal inside: exit

        val events = generateSequence { all.events.tryReceive().getOrNull() }.toList()
        assertEquals(
            listOf("enter:car:null", "exit:car:null", "enter:van:null", "exit:van:removed"),
            events.map { "${it.type}:${it.entityId}:${it.reason}" },
        )
        assertTrue(events.all { it.zoneId == "zone" })
        assertEquals(40.7580, events[0].lat, 1e-9)
        assertEquals(4, generateSequence { onlyZone.events.tryReceive().getOrNull() }.count())
        assertNull(onlyOther.events.tryReceive().getOrNull())
        assertEquals(3, s.events.subscriberCount)
        all.close(); onlyZone.close(); onlyOther.close()
        assertEquals(0, s.events.subscriberCount)
    }

    @Test
    fun expiringAnEntityInsideAZoneRaisesAnExpiredExit() {
        val s = service()
        s.zones.put(Zone("zone", "Midtown", 40.7580, -73.9855, 500.0))
        val sub = s.events.subscribe("zone")
        s.apply(s.toItem(update("car", 40.7580, -73.9855, clock.nowMillis())))
        clock.advance(11_000)
        assertEquals(1, s.expireNow())
        val events = generateSequence { sub.events.tryReceive().getOrNull() }.toList()
        assertEquals(listOf("enter", "exit"), events.map { it.type })
        assertEquals("expired", events[1].reason)
    }

    @Test
    fun aSlowSubscriberLosesEventsInsteadOfBlockingIngest() {
        val hub = EventHub(bufferSize = 2)
        val sub = hub.subscribe()
        repeat(5) { hub.publish(ZoneEvent("enter", "z", "e$it", 0.0, 0.0, 0)) }
        assertEquals(5L, hub.published)
        assertEquals(3L, hub.dropped)
        sub.close()
        hub.publish(ZoneEvent("enter", "z", "late", 0.0, 0.0, 0))
        assertEquals(3L, hub.dropped, "a closed subscription is no longer published to")
    }

    @Test
    fun removeReturnsTheEntityOnce() {
        val s = service()
        s.apply(s.toItem(update("x", ts = clock.nowMillis())))
        assertEquals("x", s.remove("x")?.id)
        assertNull(s.remove("x"))
    }

    @Test
    fun snapshotAndSummaryDescribeTheService() {
        val s = service(ServiceConfig(indexType = IndexType.GRID, ingestWorkers = 0))
        repeat(20) { s.apply(s.toItem(update("e$it", ts = clock.nowMillis()))) }
        repeat(5) { s.nearest(40.75, -73.99, 3) }
        s.within(40.75, -73.99, 1_000.0)
        val snap = s.snapshot()
        assertEquals("grid", snap.indexType)
        assertEquals(20, snap.indexSize)
        assertEquals(20L, snap.updatesApplied)
        assertEquals(5L, snap.nearestLatency.count)
        assertEquals(1L, snap.withinLatency.count)
        assertTrue(snap.updateLatency.p99Ms >= snap.updateLatency.p50Ms)
        assertTrue(s.summaryLine().contains("index=grid size=20"))
        assertTrue(s.metrics.scrape().contains("geoindex_index_size"))
    }

    @Test
    fun configReadsEnvironmentOverrides() {
        val cfg = ServiceConfig.fromEnv(
            mapOf(
                "GEOINDEX_PORT" to "9999",
                "GEOINDEX_INDEX" to "grid",
                "GEOINDEX_TTL_SECONDS" to "2.5",
                "GEOINDEX_BOUNDS" to "40.0,-74.5,41.0,-73.5",
                "GEOINDEX_DEMO" to "true",
                "GEOINDEX_QUEUE_CAPACITY" to "7",
            ),
        )
        assertEquals(9999, cfg.port)
        assertEquals(IndexType.GRID, cfg.indexType)
        assertEquals(2_500L, cfg.ttlMillis)
        assertEquals(41.0, cfg.bounds.maxLat)
        assertTrue(cfg.demo)
        assertEquals(7, cfg.queueCapacity)
        assertEquals(ServiceConfig().port, ServiceConfig.fromEnv(emptyMap()).port)
        assertThrows<IllegalArgumentException> { ServiceConfig.fromEnv(mapOf("GEOINDEX_INDEX" to "kd-tree")) }
        assertThrows<IllegalArgumentException> { ServiceConfig.fromEnv(mapOf("GEOINDEX_BOUNDS" to "1,2,3")) }
    }

    @Test
    fun everyIndexTypeCanBackTheService() {
        for (type in IndexType.entries) {
            val s = service(ServiceConfig(indexType = type, ingestWorkers = 0))
            s.apply(s.toItem(update("x", ts = clock.nowMillis())))
            assertEquals("x", s.nearest(40.75, -73.99, 1)[0].id, type.name)
        }
    }

    @Test
    fun demoFeedPopulatesAndMovesEntities() {
        val s = service(ServiceConfig(ingestWorkers = 2, maxBatchSize = 100)).start()
        val feed = DemoFeed(s, entities = 250, tickMillis = 10)
        feed.start()
        assertTrue(s.awaitIdle())
        assertEquals(250, s.index.size)
        val before = s.get("demo-7")!!
        feed.tick()
        assertTrue(s.awaitIdle())
        val after = s.get("demo-7")!!
        assertTrue(after.lat != before.lat || after.lon != before.lon, "entities should move between ticks")
        feed.close()
    }
}
