package io.geoindex.index

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantReadWriteLock

/**
 * Shared concurrency skeleton for the grid and the quadtree.
 *
 * The space is divided into stripes, each guarded by its own read-write lock, so writers in
 * different areas never block each other and readers of one stripe run in parallel. A lock is only
 * ever held while touching one stripe's cells and no thread holds two stripe locks at once, so
 * there is no lock ordering to get wrong.
 *
 * Writes to the same id are serialised by a small array of id locks. A move publishes the new
 * item to its cell first, then flips the id map, then removes the old item: at every instant at
 * least one copy of the entity is visible and readers discard copies that are no longer current.
 */
abstract class StripedIndex(
    protected val plane: Rect,
    stripeCount: Int,
) : SpatialIndex {
    private val byId = ConcurrentHashMap<String, Item>()
    private val stripes = Array(stripeCount) { ReentrantReadWriteLock() }
    private val idLocks = Array(ID_LOCKS) { Any() }

    // A second copy of an entity can only be visible while a move or removal is in flight. Readers
    // use these two counters to learn whether that happened during their scan, so the common
    // case pays nothing for duplicate handling.
    private val activeMoves = AtomicInteger()
    private val moveTouches = AtomicLong()

    /** Token for [scanWasClean]; negative when a move is already in flight. */
    protected fun beginScan(): Long = if (activeMoves.get() != 0) -1 else moveTouches.get()

    /** True when no move overlapped the scan that began with [token], so no duplicates can exist. */
    protected fun scanWasClean(token: Long): Boolean =
        token >= 0 && activeMoves.get() == 0 && moveTouches.get() == token

    private fun enterMove() {
        activeMoves.incrementAndGet()
        moveTouches.incrementAndGet()
    }

    private fun exitMove() {
        moveTouches.incrementAndGet()
        activeMoves.decrementAndGet()
    }

    override val size: Int get() = byId.size

    /** Stripe guarding the cell that holds [item]. */
    protected abstract fun stripeOf(item: Item): Int

    /** Adds [item] to its cell. The caller holds that stripe's write lock. */
    protected abstract fun insertIntoCell(item: Item)

    /** Removes [item] from its cell. The caller holds that stripe's write lock. */
    protected abstract fun removeFromCell(item: Item)

    protected fun isCurrent(item: Item): Boolean = byId[item.id] === item

    protected fun lockRead(stripe: Int) = stripes[stripe].readLock().lock()
    protected fun unlockRead(stripe: Int) = stripes[stripe].readLock().unlock()

    private fun lockWrite(stripe: Int) = stripes[stripe].writeLock().lock()
    private fun unlockWrite(stripe: Int) = stripes[stripe].writeLock().unlock()

    private fun idLock(id: String): Any = idLocks[(id.hashCode() and Int.MAX_VALUE) % ID_LOCKS]

    override fun upsert(item: Item): UpsertResult {
        require(plane.contains(item.x, item.y)) { "point (${item.x}, ${item.y}) is outside the index bounds" }
        synchronized(idLock(item.id)) {
            val prev = byId[item.id]
            if (prev != null && prev.ts > item.ts) return UpsertResult(false, prev)
            val s = stripeOf(item)
            if (prev != null) enterMove()
            try {
                lockWrite(s)
                try {
                    insertIntoCell(item)
                } finally {
                    unlockWrite(s)
                }
                byId[item.id] = item
                if (prev != null) detach(prev)
            } finally {
                if (prev != null) exitMove()
            }
            return UpsertResult(true, prev)
        }
    }

    override fun remove(id: String, maxTs: Long): Item? {
        synchronized(idLock(id)) {
            val prev = byId[id] ?: return null
            if (prev.ts > maxTs) return null
            enterMove()
            try {
                byId.remove(id)
                detach(prev)
            } finally {
                exitMove()
            }
            return prev
        }
    }

    private fun detach(item: Item) {
        val s = stripeOf(item)
        lockWrite(s)
        try {
            removeFromCell(item)
        } finally {
            unlockWrite(s)
        }
    }

    override fun get(id: String): Item? = byId[id]

    override fun clear() {
        for (id in byId.keys.toList()) remove(id)
    }

    override fun snapshot(): List<Item> = byId.values.toList()

    private companion object {
        const val ID_LOCKS = 1024
    }
}
