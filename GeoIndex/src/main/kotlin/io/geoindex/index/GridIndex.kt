package io.geoindex.index

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Fixed-size grid. Each cell holds its points; a nearest query scans the query's cell and then
 * expands outward ring by ring, stopping as soon as no unscanned cell can hold a closer point.
 */
class GridIndex(
    plane: Rect,
    private val cellSize: Double,
    stripeCount: Int = 64,
) : StripedIndex(plane, stripeCount) {
    init {
        require(cellSize > 0) { "cell size must be positive" }
        require(stripeCount > 0 && stripeCount and (stripeCount - 1) == 0) { "stripe count must be a power of two" }
        require(ceil(plane.width / cellSize) * ceil(plane.height / cellSize) <= MAX_CELLS) {
            "grid has too many cells; increase the cell size"
        }
    }

    private val cols = max(1, ceil(plane.width / cellSize).toInt())
    private val rows = max(1, ceil(plane.height / cellSize).toInt())
    private val cells = arrayOfNulls<Cell>(cols * rows)
    private val stripeMask = stripeCount - 1

    private class Cell {
        var items = arrayOfNulls<Item>(8)
        var count = 0

        fun add(item: Item) {
            if (count == items.size) items = items.copyOf(count * 2)
            items[count++] = item
        }

        fun remove(item: Item) {
            for (i in 0 until count) {
                if (items[i] === item) {
                    items[i] = items[count - 1]
                    items[count - 1] = null
                    count--
                    return
                }
            }
        }
    }

    private fun cellX(x: Double): Int = min(cols - 1, max(0, floor((x - plane.minX) / cellSize).toInt()))
    private fun cellY(y: Double): Int = min(rows - 1, max(0, floor((y - plane.minY) / cellSize).toInt()))
    private fun cellIndex(cx: Int, cy: Int) = cy * cols + cx
    private fun stripeOfCell(ci: Int) = ci and stripeMask

    override fun stripeOf(item: Item) = stripeOfCell(cellIndex(cellX(item.x), cellY(item.y)))

    override fun insertIntoCell(item: Item) {
        val ci = cellIndex(cellX(item.x), cellY(item.y))
        val cell = cells[ci] ?: Cell().also { cells[ci] = it }
        cell.add(item)
    }

    override fun removeFromCell(item: Item) {
        cells[cellIndex(cellX(item.x), cellY(item.y))]?.remove(item)
    }

    override fun nearest(x: Double, y: Double, k: Int): List<Neighbor> {
        if (k <= 0 || size == 0) return emptyList()
        val collector = KnnCollector(k)
        // A query outside the grid is measured from its projection onto the grid: every stored
        // point p satisfies |q-p|^2 >= |q-q'|^2 + |q'-p|^2.
        val qx = min(plane.maxX, max(plane.minX, x))
        val qy = min(plane.maxY, max(plane.minY, y))
        val outside2 = (x - qx) * (x - qx) + (y - qy) * (y - qy)
        val cx0 = cellX(qx)
        val cy0 = cellY(qy)

        var r = 0
        while (true) {
            scanRing(cx0, cy0, r, x, y, collector)
            var edge = Double.POSITIVE_INFINITY
            if (cx0 - r > 0) edge = min(edge, qx - (plane.minX + (cx0 - r) * cellSize))
            if (cx0 + r < cols - 1) edge = min(edge, plane.minX + (cx0 + r + 1) * cellSize - qx)
            if (cy0 - r > 0) edge = min(edge, qy - (plane.minY + (cy0 - r) * cellSize))
            if (cy0 + r < rows - 1) edge = min(edge, plane.minY + (cy0 + r + 1) * cellSize - qy)
            if (edge == Double.POSITIVE_INFINITY) break
            if (collector.isFull) {
                val safe = max(0.0, edge - EPS)
                if (collector.worstD2 < outside2 + safe * safe) break
            }
            r++
        }
        return collector.results()
    }

    private fun scanRing(cx0: Int, cy0: Int, r: Int, qx: Double, qy: Double, collector: KnnCollector) {
        if (r == 0) {
            scanCell(cellIndex(cx0, cy0), qx, qy, collector)
            return
        }
        val x0 = cx0 - r
        val x1 = cx0 + r
        val y0 = cy0 - r
        val y1 = cy0 + r
        val from = max(x0, 0)
        val to = min(x1, cols - 1)
        if (y0 >= 0) for (cx in from..to) scanCell(cellIndex(cx, y0), qx, qy, collector)
        if (y1 < rows) for (cx in from..to) scanCell(cellIndex(cx, y1), qx, qy, collector)
        val fromY = max(y0 + 1, 0)
        val toY = min(y1 - 1, rows - 1)
        if (x0 >= 0) for (cy in fromY..toY) scanCell(cellIndex(x0, cy), qx, qy, collector)
        if (x1 < cols) for (cy in fromY..toY) scanCell(cellIndex(x1, cy), qx, qy, collector)
    }

    private fun scanCell(ci: Int, qx: Double, qy: Double, collector: KnnCollector) {
        val stripe = stripeOfCell(ci)
        lockRead(stripe)
        try {
            val cell = cells[ci] ?: return
            val items = cell.items
            for (i in 0 until cell.count) {
                val item = items[i]!!
                val d2 = squaredDistance(qx, qy, item)
                if (collector.accepts(d2, item.id) && isCurrent(item)) collector.add(item, d2)
            }
        } finally {
            unlockRead(stripe)
        }
    }

    override fun withinRadius(x: Double, y: Double, radius: Double): List<Neighbor> {
        if (radius < 0 || size == 0) return emptyList()
        val r2 = radius * radius
        val hits = ArrayList<Neighbor>()
        val token = beginScan()
        val cxFrom = cellX(x - radius)
        val cxTo = cellX(x + radius)
        val cyFrom = cellY(y - radius)
        val cyTo = cellY(y + radius)
        for (cy in cyFrom..cyTo) {
            val minY = plane.minY + cy * cellSize
            for (cx in cxFrom..cxTo) {
                val minX = plane.minX + cx * cellSize
                if (squaredDistanceToRect(x, y, minX, minY, minX + cellSize, minY + cellSize) > r2) continue
                val ci = cellIndex(cx, cy)
                val stripe = stripeOfCell(ci)
                lockRead(stripe)
                try {
                    val cell = cells[ci] ?: continue
                    for (i in 0 until cell.count) {
                        val item = cell.items[i]!!
                        val d2 = squaredDistance(x, y, item)
                        if (d2 <= r2) hits.add(Neighbor(item, Math.sqrt(d2)))
                    }
                } finally {
                    unlockRead(stripe)
                }
            }
        }
        return rankedNeighbors(hits, dedupe = !scanWasClean(token))
    }

    private companion object {
        const val MAX_CELLS = 64_000_000L
        const val EPS = 1e-9
    }
}
