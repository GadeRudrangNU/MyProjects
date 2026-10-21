package io.geoindex.index

import java.util.concurrent.ConcurrentHashMap

/** Scans every point on every query. The performance baseline and the correctness oracle. */
class BruteForceIndex : SpatialIndex {
    private val byId = ConcurrentHashMap<String, Item>()

    override val size: Int get() = byId.size

    override fun upsert(item: Item): UpsertResult {
        var result: UpsertResult? = null
        byId.compute(item.id) { _, prev ->
            if (prev != null && prev.ts > item.ts) {
                result = UpsertResult(false, prev)
                prev
            } else {
                result = UpsertResult(true, prev)
                item
            }
        }
        return result!!
    }

    override fun remove(id: String, maxTs: Long): Item? {
        var removed: Item? = null
        byId.computeIfPresent(id) { _, prev ->
            if (prev.ts <= maxTs) {
                removed = prev
                null
            } else {
                prev
            }
        }
        return removed
    }

    override fun get(id: String): Item? = byId[id]

    override fun nearest(x: Double, y: Double, k: Int): List<Neighbor> {
        if (k <= 0) return emptyList()
        val collector = KnnCollector(k)
        for (item in byId.values) {
            val d2 = squaredDistance(x, y, item)
            if (collector.accepts(d2, item.id)) collector.add(item, d2)
        }
        return collector.results()
    }

    override fun withinRadius(x: Double, y: Double, radius: Double): List<Neighbor> {
        val r2 = radius * radius
        val hits = ArrayList<Neighbor>()
        for (item in byId.values) {
            val d2 = squaredDistance(x, y, item)
            if (d2 <= r2) hits.add(Neighbor(item, Math.sqrt(d2)))
        }
        return rankedNeighbors(hits)
    }

    override fun clear() = byId.clear()

    override fun snapshot(): List<Item> = byId.values.toList()
}
