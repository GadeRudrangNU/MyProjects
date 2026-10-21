package io.geoindex.service

import io.geoindex.data.Dataset
import io.geoindex.data.LatLon
import io.geoindex.data.SyntheticCity
import java.util.SplittableRandom

/** Feeds the service a population of random-walking entities so the demo map has something to show. */
class DemoFeed(
    private val service: GeoService,
    private val entities: Int,
    private val dataset: Dataset = SyntheticCity(service.config.bounds),
    private val stepMeters: Double = 30.0,
    private val tickMillis: Long = 500,
) : AutoCloseable {
    private val positions: Array<LatLon> = dataset.positions(entities).toTypedArray()
    private val rng = SplittableRandom(2024)
    private val thread = Thread(::loop, "geoindex-demo-feed").apply { isDaemon = true }

    @Volatile
    private var running = true

    fun start() {
        publish()
        thread.start()
    }

    /** Moves every entity one step and submits the new positions in batches. */
    fun tick() {
        for (i in positions.indices) positions[i] = dataset.step(positions[i], rng, stepMeters)
        publish()
    }

    private fun publish() {
        val batchSize = service.config.maxBatchSize
        val now = service.nowMillis()
        positions.asList().chunked(batchSize).forEachIndexed { b, chunk ->
            val updates = chunk.mapIndexed { j, p -> PositionUpdate("demo-${b * batchSize + j}", p.lat, p.lon, now) }
            service.submit(updates)
        }
    }

    private fun loop() {
        while (running) {
            try {
                Thread.sleep(tickMillis)
            } catch (ignored: InterruptedException) {
                return
            }
            tick()
        }
    }

    override fun close() {
        running = false
        thread.interrupt()
    }
}
