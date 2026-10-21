package io.geoindex.service

import io.geoindex.geo.Projection
import io.geoindex.index.Item
import kotlinx.coroutines.channels.Channel
import kotlinx.serialization.Serializable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicLong

/** A circular area subscribers can watch. */
@Serializable
data class Zone(
    val id: String,
    val name: String = id,
    val lat: Double,
    val lon: Double,
    val radiusMeters: Double,
)

/** An entity crossing a zone boundary. [reason] is set when the exit was not caused by movement. */
@Serializable
data class ZoneEvent(
    val type: String,
    val zoneId: String,
    val entityId: String,
    val lat: Double,
    val lon: Double,
    val ts: Long,
    val reason: String? = null,
)

class ZoneShape(val zone: Zone, private val cx: Double, private val cy: Double) {
    private val r2 = zone.radiusMeters * zone.radiusMeters

    fun contains(item: Item): Boolean {
        val dx = item.x - cx
        val dy = item.y - cy
        return dx * dx + dy * dy <= r2
    }
}

class ZoneRegistry(private val projection: Projection) {
    private val byId = ConcurrentHashMap<String, ZoneShape>()

    @Volatile
    private var shapes: Array<ZoneShape> = emptyArray()

    val size: Int get() = byId.size

    /** Current zones for hot-path iteration; the array is replaced, never mutated. */
    fun shapes(): Array<ZoneShape> = shapes

    fun list(): List<Zone> = shapes.map { it.zone }.sortedBy { it.id }

    fun get(id: String): Zone? = byId[id]?.zone

    @Synchronized
    fun put(zone: Zone) {
        byId[zone.id] = ZoneShape(zone, projection.x(zone.lon), projection.y(zone.lat))
        shapes = byId.values.toTypedArray()
    }

    @Synchronized
    fun remove(id: String): Boolean {
        val removed = byId.remove(id) != null
        if (removed) shapes = byId.values.toTypedArray()
        return removed
    }
}

/** A live feed of zone events. Closing it unregisters it from the hub. */
class Subscription internal constructor(
    val zoneId: String?,
    val events: Channel<ZoneEvent>,
    private val hub: EventHub,
) : AutoCloseable {
    override fun close() {
        hub.unsubscribe(this)
        events.close()
    }
}

/**
 * Fans events out to subscribers through bounded channels. A subscriber that cannot keep up loses
 * events (counted) instead of slowing ingest down.
 */
class EventHub(private val bufferSize: Int = 256) {
    private val subscribers = CopyOnWriteArrayList<Subscription>()
    private val publishedCount = AtomicLong()
    private val droppedCount = AtomicLong()

    val subscriberCount: Int get() = subscribers.size
    val published: Long get() = publishedCount.get()
    val dropped: Long get() = droppedCount.get()

    fun subscribe(zoneId: String? = null): Subscription {
        val sub = Subscription(zoneId, Channel(bufferSize), this)
        subscribers.add(sub)
        return sub
    }

    internal fun unsubscribe(sub: Subscription) {
        subscribers.remove(sub)
    }

    fun publish(event: ZoneEvent) {
        publishedCount.incrementAndGet()
        for (sub in subscribers) {
            if (sub.zoneId != null && sub.zoneId != event.zoneId) continue
            if (sub.events.trySend(event).isFailure) droppedCount.incrementAndGet()
        }
    }
}
