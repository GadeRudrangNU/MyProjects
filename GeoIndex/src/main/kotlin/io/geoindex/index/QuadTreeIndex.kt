package io.geoindex.index

import java.util.PriorityQueue
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Adaptive quadtree. A cell splits into four once it holds more than [leafCapacity] points, so
 * crowded areas get fine cells and empty areas stay coarse. Nearest search is best-first branch
 * and bound: a priority queue ordered by the distance from the query to each cell or point.
 *
 * The plane is first cut into a square array of tiles, each the root of its own tree and its own
 * lock stripe, so writers in different parts of the city do not contend.
 */
class QuadTreeIndex(
    plane: Rect,
    private val leafCapacity: Int = 32,
    tilesPerSide: Int = 8,
    private val maxDepth: Int = 24,
) : StripedIndex(plane, tilesPerSide * tilesPerSide) {
    private val tiles = tilesPerSide
    private val tileWidth = plane.width / tilesPerSide
    private val tileHeight = plane.height / tilesPerSide
    private val roots: Array<Node>

    init {
        require(leafCapacity >= 1) { "leaf capacity must be positive" }
        require(tilesPerSide >= 1) { "tilesPerSide must be positive" }
        roots = Array(tiles * tiles) { t ->
            val tx = t % tiles
            val ty = t / tiles
            val minX = plane.minX + tx * tileWidth
            val minY = plane.minY + ty * tileHeight
            // The last tile on each axis extends to the plane edge exactly.
            val maxX = if (tx == tiles - 1) plane.maxX else minX + tileWidth
            val maxY = if (ty == tiles - 1) plane.maxY else minY + tileHeight
            Node(minX, minY, maxX, maxY, 0, t)
        }
    }

    private class Node(
        val minX: Double,
        val minY: Double,
        val maxX: Double,
        val maxY: Double,
        val depth: Int,
        val tile: Int,
    ) {
        val midX = (minX + maxX) / 2
        val midY = (minY + maxY) / 2
        var items: Array<Item?>? = arrayOfNulls(4)
        var count = 0
        var children: Array<Node>? = null

        fun quadrant(x: Double, y: Double): Int = (if (x >= midX) 1 else 0) + (if (y >= midY) 2 else 0)

        fun add(item: Item) {
            var arr = items!!
            if (count == arr.size) {
                arr = arr.copyOf(count * 2)
                items = arr
            }
            arr[count++] = item
        }

        fun remove(item: Item): Boolean {
            val arr = items ?: return false
            for (i in 0 until count) {
                if (arr[i] === item) {
                    arr[i] = arr[count - 1]
                    arr[count - 1] = null
                    count--
                    return true
                }
            }
            return false
        }
    }

    private fun tileOf(x: Double, y: Double): Int {
        val tx = min(tiles - 1, max(0, floor((x - plane.minX) / tileWidth).toInt()))
        val ty = min(tiles - 1, max(0, floor((y - plane.minY) / tileHeight).toInt()))
        return ty * tiles + tx
    }

    override fun stripeOf(item: Item) = tileOf(item.x, item.y)

    override fun insertIntoCell(item: Item) {
        var node = roots[tileOf(item.x, item.y)]
        while (true) {
            val kids = node.children ?: break
            node = kids[node.quadrant(item.x, item.y)]
        }
        node.add(item)
        split(node)
    }

    private fun split(node: Node) {
        if (node.count <= leafCapacity || node.depth >= maxDepth) return
        val old = node.items!!
        val count = node.count
        val kids = arrayOf(
            Node(node.minX, node.minY, node.midX, node.midY, node.depth + 1, node.tile),
            Node(node.midX, node.minY, node.maxX, node.midY, node.depth + 1, node.tile),
            Node(node.minX, node.midY, node.midX, node.maxY, node.depth + 1, node.tile),
            Node(node.midX, node.midY, node.maxX, node.maxY, node.depth + 1, node.tile),
        )
        for (i in 0 until count) {
            val item = old[i]!!
            kids[node.quadrant(item.x, item.y)].add(item)
        }
        node.items = null
        node.count = 0
        node.children = kids
        for (kid in kids) split(kid)
    }

    override fun removeFromCell(item: Item) {
        removeFrom(roots[tileOf(item.x, item.y)], item)
    }

    private fun removeFrom(node: Node, item: Item): Boolean {
        val kids = node.children ?: return node.remove(item)
        val removed = removeFrom(kids[node.quadrant(item.x, item.y)], item)
        if (removed) mergeIfSparse(node, kids)
        return removed
    }

    private fun mergeIfSparse(node: Node, kids: Array<Node>) {
        var total = 0
        for (kid in kids) {
            if (kid.children != null) return
            total += kid.count
        }
        if (total > leafCapacity / 2) return
        val merged = arrayOfNulls<Item>(max(4, total))
        var n = 0
        for (kid in kids) for (i in 0 until kid.count) merged[n++] = kid.items!![i]
        node.items = merged
        node.count = total
        node.children = null
    }

    private class Entry(val key: Double, val node: Node?, val item: Item?)

    override fun nearest(x: Double, y: Double, k: Int): List<Neighbor> {
        if (k <= 0 || size == 0) return emptyList()
        val queue = PriorityQueue<Entry>(256) { a, b ->
            val c = a.key.compareTo(b.key)
            when {
                c != 0 -> c
                a.node != null && b.node == null -> -1
                a.node == null && b.node != null -> 1
                a.item != null && b.item != null -> a.item.id.compareTo(b.item.id)
                else -> 0
            }
        }
        for (root in roots) {
            queue.add(Entry(squaredDistanceToRect(x, y, root.minX, root.minY, root.maxX, root.maxY), root, null))
        }
        val hits = ArrayList<Neighbor>(k)
        val seen = HashSet<String>()
        while (hits.size < k) {
            val e = queue.poll() ?: break
            val item = e.item
            if (item != null) {
                if (isCurrent(item) && seen.add(item.id)) hits.add(Neighbor(item, Math.sqrt(e.key)))
                continue
            }
            val node = e.node!!
            lockRead(node.tile)
            try {
                val kids = node.children
                if (kids != null) {
                    for (kid in kids) {
                        val d2 = squaredDistanceToRect(x, y, kid.minX, kid.minY, kid.maxX, kid.maxY)
                        queue.add(Entry(d2, kid, null))
                    }
                } else {
                    val items = node.items!!
                    for (i in 0 until node.count) {
                        val it = items[i]!!
                        queue.add(Entry(squaredDistance(x, y, it), null, it))
                    }
                }
            } finally {
                unlockRead(node.tile)
            }
        }
        return hits
    }

    override fun withinRadius(x: Double, y: Double, radius: Double): List<Neighbor> {
        if (radius < 0 || size == 0) return emptyList()
        val r2 = radius * radius
        val hits = ArrayList<Neighbor>()
        val stack = ArrayList<Node>()
        val token = beginScan()
        for (root in roots) {
            if (squaredDistanceToRect(x, y, root.minX, root.minY, root.maxX, root.maxY) > r2) continue
            lockRead(root.tile)
            try {
                stack.add(root)
                while (stack.isNotEmpty()) {
                    val node = stack.removeAt(stack.size - 1)
                    val kids = node.children
                    if (kids != null) {
                        for (kid in kids) {
                            if (squaredDistanceToRect(x, y, kid.minX, kid.minY, kid.maxX, kid.maxY) <= r2) stack.add(kid)
                        }
                    } else {
                        val items = node.items!!
                        for (i in 0 until node.count) {
                            val item = items[i]!!
                            val d2 = squaredDistance(x, y, item)
                            if (d2 <= r2) hits.add(Neighbor(item, Math.sqrt(d2)))
                        }
                    }
                }
            } finally {
                unlockRead(root.tile)
            }
        }
        return rankedNeighbors(hits, dedupe = !scanWasClean(token))
    }

    /** Depth of the deepest leaf, for diagnostics and tests. */
    fun maxObservedDepth(): Int {
        var deepest = 0
        fun walk(n: Node) {
            val kids = n.children
            if (kids == null) deepest = max(deepest, n.depth) else kids.forEach { walk(it) }
        }
        roots.forEach { walk(it) }
        return deepest
    }

    /** Number of leaf cells across all tiles, for diagnostics and tests. */
    fun leafCount(): Int {
        var leaves = 0
        fun walk(n: Node) {
            val kids = n.children
            if (kids == null) leaves++ else kids.forEach { walk(it) }
        }
        roots.forEach { walk(it) }
        return leaves
    }
}
