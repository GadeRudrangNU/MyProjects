package io.geoindex.api

import io.geoindex.service.GeoService
import io.geoindex.service.PositionUpdate
import io.geoindex.service.ServiceConfig
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ApiTest {
    private fun update(id: String, lat: Double, lon: Double) = """{"id":"$id","lat":$lat,"lon":$lon}"""

    private suspend fun ApplicationTestBuilder.postJson(path: String, body: String): HttpResponse =
        client.post(path) {
            contentType(ContentType.Application.Json)
            setBody(body)
        }

    private suspend fun HttpResponse.json(): JsonObject = Json.parseToJsonElement(bodyAsText()).jsonObject

    private fun withService(config: ServiceConfig = ServiceConfig(ingestWorkers = 2), block: suspend ApplicationTestBuilder.(GeoService) -> Unit) {
        val service = GeoService(config)
        try {
            testApplication {
                application { geoIndexModule(service) }
                block(service)
            }
        } finally {
            service.close()
        }
    }

    @Test
    fun ingestThenQueryEndToEnd() = withService { service ->
        service.start()
        val res = postJson(
            "/v1/positions",
            """{"updates":[${update("a", 40.7580, -73.9855)},${update("b", 40.6892, -74.0445)},${update("c", 40.7484, -73.9857)}]}""",
        )
        assertEquals(HttpStatusCode.Accepted, res.status)
        assertEquals(3, res.json()["accepted"]!!.jsonPrimitive.content.toInt())
        assertTrue(service.awaitIdle())

        val nearest = client.get("/v1/nearest?lat=40.7484&lon=-73.9857&k=2").json()["results"]!!.jsonArray
        assertEquals(listOf("c", "a"), nearest.map { it.jsonObject["id"]!!.jsonPrimitive.content })
        assertEquals(0.0, nearest[0].jsonObject["distanceMeters"]!!.jsonPrimitive.content.toDouble(), 1e-6)

        val within = client.get("/v1/within?lat=40.7484&lon=-73.9857&radius=2000").json()
        assertEquals(2, within["total"]!!.jsonPrimitive.content.toInt())
        assertEquals("false", within["truncated"]!!.jsonPrimitive.content)

        val entity = client.get("/v1/entities/a")
        assertEquals(HttpStatusCode.OK, entity.status)
        assertEquals("a", entity.json()["id"]!!.jsonPrimitive.content)

        assertEquals(HttpStatusCode.NoContent, client.delete("/v1/entities/a").status)
        assertEquals(HttpStatusCode.NotFound, client.get("/v1/entities/a").status)
        assertEquals(HttpStatusCode.NotFound, client.delete("/v1/entities/a").status)
    }

    @Test
    fun partiallyInvalidBatchesAreAcceptedWithACount() = withService { service ->
        service.start()
        val res = postJson("/v1/positions", """{"updates":[${update("ok", 40.75, -73.99)},${update("far", 1.0, 1.0)}]}""")
        assertEquals(HttpStatusCode.Accepted, res.status)
        val body = res.json()
        assertEquals("1", body["accepted"]!!.jsonPrimitive.content)
        assertEquals("1", body["rejected"]!!.jsonPrimitive.content)
        assertTrue(body["firstError"]!!.jsonPrimitive.content.contains("outside"))
    }

    @Test
    fun malformedAndOversizedRequestsGetClearErrors() = withService(ServiceConfig(maxBatchSize = 2, ingestWorkers = 0)) {
        assertEquals(HttpStatusCode.BadRequest, postJson("/v1/positions", "not json").status)
        assertEquals(HttpStatusCode.BadRequest, postJson("/v1/positions", """{"updates":[]}""").status)
        assertEquals(HttpStatusCode.BadRequest, postJson("/v1/positions", """{"updates":[${update("far", 1.0, 1.0)}]}""").status)
        val big = postJson("/v1/positions", """{"updates":[${update("a", 40.7, -74.0)},${update("b", 40.7, -74.0)},${update("c", 40.7, -74.0)}]}""")
        assertEquals(HttpStatusCode.PayloadTooLarge, big.status)

        assertEquals(HttpStatusCode.BadRequest, client.get("/v1/nearest?lon=-74").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/v1/nearest?lat=abc&lon=-74").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/v1/nearest?lat=40.7&lon=-74&k=0").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/v1/nearest?lat=40.7&lon=-74&k=x").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/v1/nearest?lat=40.7&lon=-74&k=99999").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/v1/within?lat=40.7&lon=-74&radius=-5").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/v1/within?lat=40.7&lon=-74&radius=1e9").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/v1/within?lat=40.7&lon=-74&radius=10&limit=0").status)
        assertTrue(client.get("/v1/nearest?lat=40.7").json()["error"]!!.jsonPrimitive.content.contains("lon"))
    }

    @Test
    fun aFullQueueAnswers429WithRetryAfterAndRecovers() = withService(ServiceConfig(queueCapacity = 1, ingestWorkers = 0)) { service ->
        val body = """{"updates":[${update("a", 40.7, -74.0)}]}"""
        assertEquals(HttpStatusCode.Accepted, postJson("/v1/positions", body).status)
        val rejected = postJson("/v1/positions", body)
        assertEquals(HttpStatusCode.TooManyRequests, rejected.status)
        assertEquals("1", rejected.headers[HttpHeaders.RetryAfter])
        assertTrue(rejected.json()["error"]!!.jsonPrimitive.content.contains("queue is full"))

        val metrics = client.get("/metrics").json()
        assertEquals("1", metrics["queueDepth"]!!.jsonPrimitive.content)
        assertEquals("1", metrics["batchesRejectedQueueFull"]!!.jsonPrimitive.content)

        service.startIngestWorkers(1)
        assertTrue(service.awaitIdle())
        assertEquals(HttpStatusCode.Accepted, postJson("/v1/positions", body).status)
    }

    @Test
    fun zoneLifecycleAndValidation() = withService(ServiceConfig(ingestWorkers = 0)) {
        val zone = """{"id":"z1","name":"Midtown","lat":40.758,"lon":-73.9855,"radiusMeters":500}"""
        assertEquals(HttpStatusCode.Created, postJson("/v1/zones", zone).status)
        val list = client.get("/v1/zones").bodyAsText()
        assertTrue(list.contains("Midtown"))
        assertEquals(HttpStatusCode.BadRequest, postJson("/v1/zones", """{"id":"","lat":40.7,"lon":-74.0,"radiusMeters":5}""").status)
        assertEquals(HttpStatusCode.BadRequest, postJson("/v1/zones", """{"id":"q","lat":10.0,"lon":-74.0,"radiusMeters":5}""").status)
        assertEquals(HttpStatusCode.BadRequest, postJson("/v1/zones", """{"id":"q","lat":40.7,"lon":-74.0,"radiusMeters":0}""").status)
        assertEquals(HttpStatusCode.NoContent, client.delete("/v1/zones/z1").status)
        assertEquals(HttpStatusCode.NotFound, client.delete("/v1/zones/z1").status)
    }

    @Test
    fun websocketSubscribersReceiveEnterAndExitEvents() = withService(ServiceConfig(ingestWorkers = 0)) { service ->
        service.zones.put(io.geoindex.service.Zone("z1", "Midtown", 40.7580, -73.9855, 500.0))
        val ws = createClient { install(WebSockets) }
        ws.webSocket("/v1/events?zone=z1") {
            val ack = Json.parseToJsonElement((incoming.receive() as Frame.Text).readText()).jsonObject
            assertEquals("subscribed", ack["type"]!!.jsonPrimitive.content)
            assertEquals(1, service.events.subscriberCount)

            val t = System.currentTimeMillis()
            service.apply(service.toItem(PositionUpdate("car", 40.7000, -73.9855, t)))
            service.apply(service.toItem(PositionUpdate("car", 40.7580, -73.9855, t + 1)))
            service.apply(service.toItem(PositionUpdate("car", 40.7000, -73.9855, t + 2)))

            val seen = withTimeout(5_000) {
                List(2) { Json.parseToJsonElement((incoming.receive() as Frame.Text).readText()).jsonObject }
            }
            assertEquals(listOf("enter", "exit"), seen.map { it["type"]!!.jsonPrimitive.content })
            assertEquals("car", seen[0]["entityId"]!!.jsonPrimitive.content)
            assertEquals("z1", seen[0]["zoneId"]!!.jsonPrimitive.content)
        }
        // Closing the socket unregisters the subscriber.
        withTimeout(5_000) { while (service.events.subscriberCount > 0) kotlinx.coroutines.delay(10) }
    }

    @Test
    fun healthMetricsAndDemoPage() = withService(ServiceConfig(ingestWorkers = 0)) {
        val health = client.get("/health").json()
        assertEquals("ok", health["status"]!!.jsonPrimitive.content)
        assertEquals(40.95, health["bounds"]!!.jsonObject["maxLat"]!!.jsonPrimitive.content.toDouble())

        val metrics = client.get("/metrics").json()
        for (key in listOf("indexSize", "queueDepth", "throughput", "updateLatency", "nearestLatency", "withinLatency")) {
            assertTrue(key in metrics, "missing $key")
        }
        assertTrue("p99Ms" in metrics["nearestLatency"]!!.jsonObject)

        val prometheus = client.get("/metrics/prometheus").bodyAsText()
        assertTrue(prometheus.contains("geoindex_ingest_queue_depth"))

        val page = client.get("/")
        assertEquals(HttpStatusCode.OK, page.status)
        assertTrue(page.bodyAsText().contains("GeoIndex"))
    }
}
