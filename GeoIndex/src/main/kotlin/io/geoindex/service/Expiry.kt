package io.geoindex.service

import io.geoindex.index.Item
import io.geoindex.index.SpatialIndex
import java.util.PriorityQueue

/**
 * Min-heap of entities ordered by the last-seen time they were queued with.
 *
 * Re-reporting never touches the heap. Each entity holds one entry, and when that entry comes due
 * the sweeper compares it with the entity's current timestamp: a newer one means the entity kept
 * reporting, so the entry is re-queued at the newer time instead of the entity being expired. That
 * keeps the heap at one entry per entity and makes a position update a single index write.
 */
class ExpiryQueue {
    private class Entry(val id: String, val ts: Long)

    private val heap = PriorityQueue<Entry>(1024) { a, b -> a.ts.compareTo(b.ts) }

    val size: Int @Synchronized get() = heap.size

    @Synchronized
    fun track(id: String, ts: Long) {
        heap.add(Entry(id, ts))
    }

    /** Pops the oldest entry if it is due at [cutoff] (its time is at or before it). */
    @Synchronized
    private fun pollDue(cutoff: Long): Entry? {
        val head = heap.peek() ?: return null
        return if (head.ts <= cutoff) heap.poll() else null
    }

    /**
     * Removes every entity whose last report is at or before [cutoff], handing each removed item to
     * [onExpired]. Stops after [limit] pops so one sweep cannot monopolise a thread.
     */
    fun sweep(index: SpatialIndex, cutoff: Long, limit: Int = Int.MAX_VALUE, onExpired: (Item) -> Unit): Int {
        var expired = 0
        var pops = 0
        while (pops < limit) {
            val entry = pollDue(cutoff) ?: break
            pops++
            val current = index[entry.id] ?: continue
            if (current.ts > cutoff) {
                track(entry.id, current.ts)
                continue
            }
            val removed = index.remove(entry.id, cutoff)
            if (removed != null) {
                expired++
                onExpired(removed)
            } else {
                // The entity re-reported between the lookup and the removal.
                index[entry.id]?.let { track(it.id, it.ts) }
            }
        }
        return expired
    }
}
