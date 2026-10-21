package io.geoindex.api

import io.geoindex.service.GeoService
import io.geoindex.service.Located
import io.geoindex.service.PositionUpdate
import io.geoindex.service.SubmitResult
import io.geoindex.service.Zone
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import io.ktor.server.routing.RoutingContext
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.pingPeriod
import io.ktor.server.websocket.timeout
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.Frame
import io.ktor.server.http.content.staticResources
import kotlinx.coroutines.launch
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.time.Duration.Companion.seconds

@Serializable
data class UpdateDto(val id: String, val lat: Double, val lon: Double, val ts: Long? = null)

@Serializable
data class BatchRequest(val updates: List<UpdateDto>)

@Serializable
data class BatchResponse(val accepted: Int, val rejected: Int, val queueDepth: Int, val firstError: String? = null)

@Serializable
data class ErrorBody(val error: String)

@Serializable
data class EntityDto(
    val id: String,
    val lat: Double,
    val lon: Double,
    val ts: Long,
    val distanceMeters: Double? = null,
)

@Serializable
data class NearestResponse(val results: List<EntityDto>)

@Serializable
data class WithinResponse(val results: List<EntityDto>, val total: Int, val truncated: Boolean)

@Serializable
data class SubscribedAck(val type: String = "subscribed", val zoneId: String? = null)

@Serializable
data class BoundsDto(val minLat: Double, val minLon: Double, val maxLat: Double, val maxLon: Double)

@Serializable
data class HealthResponse(val status: String, val indexSize: Int, val queueDepth: Int, val bounds: BoundsDto)

private class ApiException(val status: HttpStatusCode, message: String) : RuntimeException(message)

@OptIn(ExperimentalSerializationApi::class)
internal val apiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

private fun Located.dto() = EntityDto(id, lat, lon, ts, distanceMeters)

private fun RoutingContext.param(name: String): String =
    call.request.queryParameters[name] ?: throw ApiException(HttpStatusCode.BadRequest, "query parameter '$name' is required")

private fun RoutingContext.number(name: String): Double =
    param(name).toDoubleOrNull()?.takeIf { it.isFinite() }
        ?: throw ApiException(HttpStatusCode.BadRequest, "query parameter '$name' must be a number")

private fun RoutingContext.intParam(name: String, default: Int): Int =
    call.request.queryParameters[name]?.let {
        it.toIntOrNull() ?: throw ApiException(HttpStatusCode.BadRequest, "query parameter '$name' must be an integer")
    } ?: default

fun Application.geoIndexModule(service: GeoService) {
    val config = service.config

    install(ContentNegotiation) { json(apiJson) }
    install(WebSockets) {
        pingPeriod = 15.seconds
        timeout = 30.seconds
    }
    install(StatusPages) {
        exception<ApiException> { call, e -> call.respond(e.status, ErrorBody(e.message ?: "error")) }
        exception<SerializationException> { call, e -> call.respond(HttpStatusCode.BadRequest, ErrorBody("malformed request body: ${e.message}")) }
        exception<io.ktor.server.plugins.BadRequestException> { call, e ->
            call.respond(HttpStatusCode.BadRequest, ErrorBody("malformed request body: ${e.cause?.message ?: e.message}"))
        }
        exception<IllegalArgumentException> { call, e -> call.respond(HttpStatusCode.BadRequest, ErrorBody(e.message ?: "invalid request")) }
        exception<Throwable> { call, e ->
            call.application.environment.log.error("unhandled error", e)
            call.respond(HttpStatusCode.InternalServerError, ErrorBody("internal error"))
        }
    }

    routing {
        get("/health") {
            val b = config.bounds
            call.respond(HealthResponse("ok", service.index.size, service.queueDepth, BoundsDto(b.minLat, b.minLon, b.maxLat, b.maxLon)))
        }
        get("/metrics") { call.respond(service.snapshot()) }
        get("/metrics/prometheus") { call.respondText(service.metrics.scrape()) }

        post("/v1/positions") {
            val body = call.receive<BatchRequest>()
            if (body.updates.isEmpty()) throw ApiException(HttpStatusCode.BadRequest, "updates must not be empty")
            if (body.updates.size > config.maxBatchSize) {
                throw ApiException(HttpStatusCode.PayloadTooLarge, "a batch holds at most ${config.maxBatchSize} updates")
            }
            val updates = body.updates.map { PositionUpdate(it.id, it.lat, it.lon, it.ts) }
            when (val result = service.submit(updates)) {
                is SubmitResult.QueueFull -> {
                    call.response.header(HttpHeaders.RetryAfter, "1")
                    call.respond(
                        HttpStatusCode.TooManyRequests,
                        ErrorBody("ingest queue is full (${result.queueDepth}/${result.capacity}); retry shortly"),
                    )
                }
                is SubmitResult.Accepted -> {
                    if (result.accepted == 0) {
                        throw ApiException(HttpStatusCode.BadRequest, "no valid updates: ${result.firstError}")
                    }
                    call.respond(
                        HttpStatusCode.Accepted,
                        BatchResponse(result.accepted, result.rejected, result.queueDepth, result.firstError),
                    )
                }
            }
        }

        get("/v1/nearest") {
            val lat = number("lat")
            val lon = number("lon")
            val k = intParam("k", 10)
            if (k !in 1..config.maxK) throw ApiException(HttpStatusCode.BadRequest, "k must be between 1 and ${config.maxK}")
            call.respond(NearestResponse(service.nearest(lat, lon, k).map { it.dto() }))
        }

        get("/v1/within") {
            val lat = number("lat")
            val lon = number("lon")
            val radius = number("radius")
            if (radius < 0 || radius > config.maxRadiusMeters) {
                throw ApiException(HttpStatusCode.BadRequest, "radius must be between 0 and ${config.maxRadiusMeters} meters")
            }
            val limit = intParam("limit", config.maxResults)
            if (limit !in 1..config.maxResults) throw ApiException(HttpStatusCode.BadRequest, "limit must be between 1 and ${config.maxResults}")
            val range = service.within(lat, lon, radius, limit)
            call.respond(WithinResponse(range.hits.map { it.dto() }, range.total, range.truncated))
        }

        get("/v1/entities/{id}") {
            val entity = service.get(call.parameters["id"]!!)
                ?: throw ApiException(HttpStatusCode.NotFound, "entity not found")
            call.respond(entity.dto())
        }

        delete("/v1/entities/{id}") {
            service.remove(call.parameters["id"]!!) ?: throw ApiException(HttpStatusCode.NotFound, "entity not found")
            call.respond(HttpStatusCode.NoContent)
        }

        get("/v1/zones") { call.respond(service.zones.list()) }

        post("/v1/zones") {
            val zone = call.receive<Zone>()
            if (zone.id.isBlank()) throw ApiException(HttpStatusCode.BadRequest, "zone id is required")
            if (!zone.lat.isFinite() || !zone.lon.isFinite() || !config.bounds.contains(zone.lat, zone.lon)) {
                throw ApiException(HttpStatusCode.BadRequest, "zone center must lie inside the service bounds")
            }
            if (!zone.radiusMeters.isFinite() || zone.radiusMeters <= 0 || zone.radiusMeters > config.maxRadiusMeters) {
                throw ApiException(HttpStatusCode.BadRequest, "radiusMeters must be between 0 and ${config.maxRadiusMeters}")
            }
            service.zones.put(zone)
            call.respond(HttpStatusCode.Created, zone)
        }

        delete("/v1/zones/{id}") {
            if (!service.zones.remove(call.parameters["id"]!!)) throw ApiException(HttpStatusCode.NotFound, "zone not found")
            call.respond(HttpStatusCode.NoContent)
        }

        webSocket("/v1/events") {
            val zoneId = call.request.queryParameters["zone"]
            val subscription = service.events.subscribe(zoneId)
            try {
                send(Frame.Text(apiJson.encodeToString(SubscribedAck(zoneId = zoneId))))
                val pump = launch {
                    for (event in subscription.events) {
                        send(Frame.Text(apiJson.encodeToString(event)))
                    }
                }
                try {
                    for (frame in incoming) {
                        // Clients send nothing meaningful; reading keeps close frames flowing.
                        if (frame is Frame.Close) break
                    }
                } finally {
                    pump.cancel()
                }
            } finally {
                subscription.close()
            }
        }

        staticResources("/", "web") { default("index.html") }
    }
}
