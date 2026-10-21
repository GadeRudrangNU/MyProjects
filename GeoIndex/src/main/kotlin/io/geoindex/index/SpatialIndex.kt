package io.geoindex.index

import java.util.PriorityQueue

/** A tracked entity at a position in the projected plane (meters). Immutable: a move replaces it. */
class Item(
    @JvmField val id: String,
    @JvmField val x: Double,
    @JvmField val y: Double,
    @JvmField val ts: Long,
) {
    override fun toString() = "Item($id, $x, $y, ts=$ts)"
}

/** A query hit with its distance from the query point in meters. */
class Neighbor(@JvmField val item: Item, @JvmField val distance: Double)

/**
 * Outcome of [SpatialIndex.upsert]. [applied] is false when the index already held a newer
 * report for the id; [previous] is whatever the index held for the id before the call.
 */
class UpsertResult(@JvmField val applied: Boolean, @JvmField val previous: Item?)

/** Axis-aligned rectangle in the projected plane. */
data class Rect(val minX: Double, val minY: Double, val maxX: Double, val maxY: Double) {
    init {
        require(minX < maxX && minY < maxY) { "rectangle must have positive extent" }
    }

    val width: Double get() = maxX - minX
    val height: Double get() = maxY - minY

    fun contains(x: Double, y: Double) = x >= minX && x <= maxX && y >= minY && y <= maxY
}

/**
 * A spatial index over moving points keyed by id. Distances are Euclidean in the projected plane
 * and results are ordered by (distance, id), so every implementation returns identical answers.
 *
 * Implementations are safe for concurrent use. Reads are weakly consistent while writes are in
 * flight (a result may reflect an entity's old or new position, never both and never a torn one)
 * and exact once writers are quiescent.
 */
interface SpatialIndex {
    val size: Int

    /** Inserts or moves an entity. Reports older than the stored one are ignored. */
    fun upsert(item: Item): UpsertResult

    /** Removes the entity if its stored timestamp is at most [maxTs]; returns what was removed. */
    fun remove(id: String, maxTs: Long = Long.MAX_VALUE): Item?

    operator fun get(id: String): Item?

    /** The [k] closest entities to (x, y), nearest first. */
    fun nearest(x: Double, y: Double, k: Int): List<Neighbor>

    /** Every entity within [radius] meters of (x, y), nearest first. */
    fun withinRadius(x: Double, y: Double, radius: Double): List<Neighbor>

    fun clear()

    /** Point-in-time copy of every stored entity. */
    fun snapshot(): List<Item>
}

internal fun squaredDistance(x: Double, y: Double, item: Item): Double {
    val dx = item.x - x
    val dy = item.y - y
    return dx * dx + dy * dy
}

internal fun squaredDistanceToRect(
    x: Double, y: Double, minX: Double, minY: Double, maxX: Double, maxY: Double,
): Double {
    val dx = if (x < minX) minX - x else if (x > maxX) x - maxX else 0.0
    val dy = if (y < minY) minY - y else if (y > maxY) y - maxY else 0.0
    return dx * dx + dy * dy
}

internal class Candidate(val item: Item, val d2: Double)

/** Keeps the k best (distance, id) candidates seen so far in a max-heap. */
internal class KnnCollector(private val k: Int) {
    private val heap = PriorityQueue<Candidate>(k + 1) { a, b ->
        val c = b.d2.compareTo(a.d2)
        if (c != 0) c else b.item.id.compareTo(a.item.id)
    }

    val isFull: Boolean get() = heap.size >= k

    /** Squared distance of the current k-th best candidate, or infinity until k are held. */
    val worstD2: Double get() = if (heap.size < k) Double.POSITIVE_INFINITY else heap.peek().d2

    fun accepts(d2: Double, id: String): Boolean {
        if (heap.size < k) return true
        val worst = heap.peek()
        return d2 < worst.d2 || (d2 == worst.d2 && id < worst.item.id)
    }

    fun add(item: Item, d2: Double) {
        heap.add(Candidate(item, d2))
        if (heap.size > k) heap.poll()
    }

    fun results(): List<Neighbor> = rankedNeighbors(heap.map { Neighbor(it.item, Math.sqrt(it.d2)) })
}

/**
 * Sorts by (distance, id) and drops duplicate ids, keeping the newest report. Duplicates only
 * arise when a read overlaps a move of the same entity.
 */
internal fun rankedNeighbors(hits: List<Neighbor>, dedupe: Boolean = true): List<Neighbor> {
    val sorted = hits.sortedWith { a, b ->
        val c = a.distance.compareTo(b.distance)
        if (c != 0) c else a.item.id.compareTo(b.item.id)
    }
    if (!dedupe) return sorted
    val seen = HashMap<String, Neighbor>(sorted.size * 2)
    for (n in sorted) {
        val prior = seen[n.item.id]
        if (prior == null || n.item.ts > prior.item.ts) seen[n.item.id] = n
    }
    if (seen.size == sorted.size) return sorted
    return sorted.filter { seen[it.item.id] === it }
}
