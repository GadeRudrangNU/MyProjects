package io.geoindex.bench

import io.geoindex.data.SyntheticCity
import io.geoindex.geo.GeoBounds
import io.geoindex.geo.Projection
import io.geoindex.index.BruteForceIndex
import io.geoindex.index.GridIndex
import io.geoindex.index.Item
import io.geoindex.index.Neighbor
import io.geoindex.index.QuadTreeIndex
import io.geoindex.index.SpatialIndex
import io.geoindex.service.planeOf
import org.openjdk.jmh.annotations.Benchmark
import org.openjdk.jmh.annotations.BenchmarkMode
import org.openjdk.jmh.annotations.Level
import org.openjdk.jmh.annotations.Mode
import org.openjdk.jmh.annotations.OutputTimeUnit
import org.openjdk.jmh.annotations.Param
import org.openjdk.jmh.annotations.Scope
import org.openjdk.jmh.annotations.Setup
import org.openjdk.jmh.annotations.State
import org.openjdk.jmh.annotations.Threads
import java.util.SplittableRandom
import java.util.concurrent.TimeUnit

/** Shared population: a clustered synthetic city loaded into the index under test. */
@State(Scope.Benchmark)
open class Population {
    @Param("brute", "grid", "quadtree")
    var kind: String = "quadtree"

    @Param("10000", "100000", "1000000")
    var size: Int = 10_000

    lateinit var index: SpatialIndex
    lateinit var queryX: DoubleArray
    lateinit var queryY: DoubleArray
    lateinit var xs: DoubleArray
    lateinit var ys: DoubleArray

    @Setup(Level.Trial)
    open fun setup() {
        val bounds = GeoBounds.NEW_YORK
        val projection = Projection.centeredOn(bounds)
        val plane = planeOf(bounds, projection)
        val city = SyntheticCity(bounds, 42)
        index = when (kind) {
            "brute" -> BruteForceIndex()
            "grid" -> GridIndex(plane, 250.0, 64)
            else -> QuadTreeIndex(plane, 32, 8)
        }
        xs = DoubleArray(size)
        ys = DoubleArray(size)
        city.positions(size).forEachIndexed { i, p ->
            xs[i] = projection.x(p.lon)
            ys[i] = projection.y(p.lat)
            index.upsert(Item("e$i", xs[i], ys[i], 1_000))
        }
        val rng = SplittableRandom(7)
        val qs = List(QUERY_POOL) { city.querySample(rng) }
        queryX = DoubleArray(QUERY_POOL) { projection.x(qs[it].lon) }
        queryY = DoubleArray(QUERY_POOL) { projection.y(qs[it].lat) }
    }

    companion object {
        const val QUERY_POOL = 4096
    }
}

@State(Scope.Thread)
open class Cursor {
    var i = 0
    val rng = SplittableRandom(System.nanoTime())
    fun next(): Int {
        i = (i + 1) and (Population.QUERY_POOL - 1)
        return i
    }
}

@BenchmarkMode(Mode.SampleTime)
@OutputTimeUnit(TimeUnit.MICROSECONDS)
open class IndexBenchmarks {
    @Benchmark
    fun nearest10(p: Population, c: Cursor): List<Neighbor> {
        val i = c.next()
        return p.index.nearest(p.queryX[i], p.queryY[i], 10)
    }

    @Benchmark
    fun within500m(p: Population, c: Cursor): List<Neighbor> {
        val i = c.next()
        return p.index.withinRadius(p.queryX[i], p.queryY[i], 500.0)
    }

    @Benchmark
    fun move(p: Population, c: Cursor): Any {
        val id = c.rng.nextInt(p.size)
        val nx = (p.xs[id] + c.rng.nextGaussian() * 25).coerceIn(-20_000.0, 20_000.0)
        val ny = (p.ys[id] + c.rng.nextGaussian() * 25).coerceIn(-20_000.0, 20_000.0)
        return try {
            p.index.upsert(Item("e$id", nx, ny, System.nanoTime()))
        } catch (e: IllegalArgumentException) {
            p.index.upsert(Item("e$id", p.xs[id], p.ys[id], System.nanoTime()))
        }
    }
}

/** Eight threads, nine reads for every move: shows what the lock striping buys. */
@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.MILLISECONDS)
@Threads(8)
open class ConcurrentBenchmarks {
    @Benchmark
    fun mixed90Read10Write(p: Population, c: Cursor): Any {
        if (c.rng.nextInt(10) != 0) {
            val i = c.next()
            return p.index.nearest(p.queryX[i], p.queryY[i], 10)
        }
        val id = c.rng.nextInt(p.size)
        return p.index.upsert(Item("e$id", p.xs[id], p.ys[id], System.nanoTime()))
    }
}
