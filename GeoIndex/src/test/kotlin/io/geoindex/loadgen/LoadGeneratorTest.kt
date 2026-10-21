package io.geoindex.loadgen

import io.geoindex.api.geoIndexModule
import io.geoindex.service.GeoService
import io.geoindex.service.IndexType
import io.geoindex.service.PositionUpdate
import io.geoindex.service.ServiceConfig
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LoadGeneratorTest {
    private val quick = LoadConfig(
        points = 2_000, durationSeconds = 1, warmupSeconds = 0, updateRate = 2_000, batch = 20,
        nearestRate = 400, withinRate = 100, updateThreads = 1, nearestThreads = 1, withinThreads = 1,
    )

    @Test
    fun parsesCommandLineFlags() {
        val cfg = LoadConfig.parse(
            arrayOf("--points", "1000000", "--index", "grid", "--duration", "30", "--update-rate", "5000", "--batch", "50", "--k", "5", "--out", "x.json"),
        )
        assertEquals(1_000_000, cfg.points)
        assertEquals(IndexType.GRID, cfg.index)
        assertEquals(30, cfg.durationSeconds)
        assertEquals(5_000, cfg.updateRate)
        assertEquals(50, cfg.batch)
        assertEquals(5, cfg.k)
        assertEquals("x.json", cfg.out)
        assertEquals(LoadConfig(), LoadConfig.parse(emptyArray()))
        assertThrows<IllegalArgumentException> { LoadConfig.parse(arrayOf("--bogus", "1")) }
        assertThrows<IllegalArgumentException> { LoadConfig.parse(arrayOf("--points")) }
        assertThrows<IllegalArgumentException> { LoadConfig.parse(arrayOf("points", "1")) }
        assertThrows<IllegalArgumentException> { LoadConfig.parse(arrayOf("--target", "carrier-pigeon")) }
        assertThrows<IllegalArgumentException> { LoadConfig.parse(arrayOf("--nearest-threads", "0")) }
    }

    @Test
    fun inProcessRunPreloadsThenReportsLatencyPercentiles() {
        val service = GeoService(ServiceConfig(indexType = IndexType.QUADTREE))
        val target = InProcessTarget(service)
        val runner = LoadRunner(quick, datasetFor(quick)) { target }
        runner.preload(target)
        assertEquals(2_000, service.index.size)

        val report = runner.run()
        assertTrue(report.updateBatch.operations > 50, "expected about 2000 updates/s in batches of 20 for 1 s")
        assertTrue(report.nearest.operations > 100)
        assertTrue(report.within.operations > 20)
        assertTrue(report.nearest.p50Ms <= report.nearest.p99Ms)
        assertTrue(report.nearest.p99Ms <= report.nearest.maxMs)
        assertTrue(report.achievedUpdatesPerSecond > 0)
        assertEquals(0, report.errors)
        val text = formatReport(report)
        assertTrue(text.contains("nearest") && text.contains("p99 ms"))
        assertEquals(2_000, service.index.size, "updates move entities, they do not create new ones")
        service.close()
    }

    @Test
    fun httpRunAgainstARealServerCountsRejections() {
        val service = GeoService(ServiceConfig(ingestWorkers = 2, queueCapacity = 4, maxBatchSize = 500)).start()
        val server = embeddedServer(Netty, port = 0, host = "127.0.0.1") { geoIndexModule(service) }.start(wait = false)
        try {
            val port = runBlocking { server.engine.resolvedConnectors().first().port }
            val cfg = quick.copy(target = "http", url = "http://127.0.0.1:$port", points = 1_000, batch = 10, updateRate = 4_000)
            val runner = LoadRunner(cfg, datasetFor(cfg)) { HttpTarget(cfg.url) }
            HttpTarget(cfg.url).use { runner.preload(it) }
            assertTrue(service.awaitIdle())
            assertEquals(1_000, service.index.size)

            val report = runner.run()
            assertEquals(0, report.errors)
            assertTrue(report.nearest.operations > 0)
            assertTrue(report.updateBatch.operations + report.rejectedBatches > 0)
        } finally {
            server.stop(100, 500)
            service.close()
        }
    }

    @Test
    fun httpTargetClassifiesOutcomes() {
        val service = GeoService(ServiceConfig(ingestWorkers = 0, queueCapacity = 1)).start()
        val server = embeddedServer(Netty, port = 0, host = "127.0.0.1") { geoIndexModule(service) }.start(wait = false)
        try {
            val port = runBlocking { server.engine.resolvedConnectors().first().port }
            HttpTarget("http://127.0.0.1:$port/").use { t ->
                val one = listOf(PositionUpdate("a", 40.7, -74.0, System.currentTimeMillis()))
                assertEquals(Outcome.OK, t.update(one))
                assertEquals(Outcome.REJECTED, t.update(one))
                assertEquals(Outcome.OK, t.nearest(40.7, -74.0, 3))
                assertEquals(Outcome.OK, t.within(40.7, -74.0, 100.0))
                assertEquals(Outcome.ERROR, t.update(listOf(PositionUpdate("far", 1.0, 1.0))))
            }
            HttpTarget("http://127.0.0.1:1").use { assertEquals(Outcome.ERROR, it.nearest(40.7, -74.0, 1)) }
        } finally {
            server.stop(100, 500)
            service.close()
        }
    }

    @Test
    fun mainRunsEndToEndAndWritesAJsonReport(@TempDir dir: File) {
        val out = File(dir, "nested/report.json")
        main(arrayOf("--points", "1500", "--duration", "1", "--warmup", "0", "--update-rate", "1000", "--batch", "10", "--nearest-rate", "250", "--within-rate", "50", "--update-threads", "1", "--nearest-threads", "1", "--within-threads", "1", "--out", out.path))
        val json = out.readText()
        assertTrue(json.contains("\"nearest\"") && json.contains("\"p99Ms\""))
    }

    @Test
    fun datasetSelectionValidatesItsInputs(@TempDir dir: File) {
        assertThrows<IllegalArgumentException> { datasetFor(quick.copy(dataset = "csv")) }
        assertThrows<IllegalArgumentException> { datasetFor(quick.copy(dataset = "parquet")) }
        val csv = File(dir, "p.csv").apply { writeText("lat,lon\n40.7,-74.0\n40.8,-73.9\n") }
        assertEquals(2, datasetFor(quick.copy(dataset = "csv", file = csv.path)).positions(2).size)
    }
}
