package io.geoindex.loadgen

import io.geoindex.service.PositionUpdate
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/** Drives a running GeoIndex service over HTTP. */
class HttpTarget(baseUrl: String) : LoadTarget {
    private val base = baseUrl.trimEnd('/')
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()

    override fun update(batch: List<PositionUpdate>): Outcome {
        val body = StringBuilder(batch.size * 64).append("{\"updates\":[")
        batch.forEachIndexed { i, u ->
            if (i > 0) body.append(',')
            body.append("{\"id\":\"").append(u.id).append("\",\"lat\":").append(u.lat)
                .append(",\"lon\":").append(u.lon)
            u.ts?.let { body.append(",\"ts\":").append(it) }
            body.append('}')
        }
        body.append("]}")
        val request = HttpRequest.newBuilder(URI.create("$base/v1/positions"))
            .header("Content-Type", "application/json")
            .timeout(Duration.ofSeconds(30))
            .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
            .build()
        return send(request)
    }

    override fun nearest(lat: Double, lon: Double, k: Int): Outcome = get("$base/v1/nearest?lat=$lat&lon=$lon&k=$k")

    override fun within(lat: Double, lon: Double, radiusMeters: Double): Outcome =
        get("$base/v1/within?lat=$lat&lon=$lon&radius=$radiusMeters")

    private fun get(url: String): Outcome =
        send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30)).GET().build())

    private fun send(request: HttpRequest): Outcome = try {
        when (client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode()) {
            200, 202 -> Outcome.OK
            429 -> Outcome.REJECTED
            else -> Outcome.ERROR
        }
    } catch (e: java.io.IOException) {
        Outcome.ERROR
    }

    override fun close() {
        // HttpClient has no close before JDK 21; connections are released with the instance.
    }
}
