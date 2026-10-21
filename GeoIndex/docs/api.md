# HTTP and WebSocket API

Base URL `http://localhost:7070`. All bodies are JSON. Coordinates are decimal degrees, distances are meters, timestamps are epoch milliseconds.

## Ingest

### `POST /v1/positions`

```json
{ "updates": [ { "id": "courier-17", "lat": 40.7580, "lon": -73.9855, "ts": 1760000000000 } ] }
```

`ts` is optional and defaults to the server clock. A report older than the one already stored for the id is ignored.

| Status | Meaning |
| --- | --- |
| `202` | Accepted onto the ingest queue. Body: `accepted`, `rejected`, `queueDepth`, and `firstError` when some updates were invalid. |
| `400` | Malformed JSON, an empty batch, or no valid update in the batch. |
| `413` | More than `GEOINDEX_MAX_BATCH` updates (default 1000). |
| `429` | The bounded ingest queue is full. `Retry-After: 1` is set; resend the batch later. |

An update is rejected when its position is outside the configured bounds, a coordinate is not finite, the id is empty or longer than 128 characters, the timestamp is more than five minutes in the future, or it is already older than the expiry window.

## Queries

### `GET /v1/nearest?lat=&lon=&k=10`

The `k` closest entities, nearest first. `k` is 1 to `GEOINDEX_MAX_K` (default 1000).

```json
{ "results": [ { "id": "courier-17", "lat": 40.758, "lon": -73.9855, "ts": 1760000000000, "distanceMeters": 112.4 } ] }
```

### `GET /v1/within?lat=&lon=&radius=500&limit=`

Everything inside the radius, nearest first. `radius` is 0 to `GEOINDEX_MAX_RADIUS_METERS` (default 50000). `limit` caps the returned list (default and maximum `GEOINDEX_MAX_RESULTS`, 10000). The response carries the full match count and a `truncated` flag.

```json
{ "results": [ ... ], "total": 1342, "truncated": true }
```

### `GET /v1/entities/{id}` and `DELETE /v1/entities/{id}`

Read or remove one entity. `404` when unknown. Deleting an entity inside a zone raises an `exit` event with reason `removed`.

## Zones

| Method and path | Purpose |
| --- | --- |
| `GET /v1/zones` | List zones |
| `POST /v1/zones` | Create or replace a zone: `{ "id": "z1", "name": "Midtown", "lat": 40.758, "lon": -73.9855, "radiusMeters": 500 }` |
| `DELETE /v1/zones/{id}` | Remove a zone |

## Live events

`GET /v1/events` upgrades to a WebSocket. Add `?zone=<id>` to receive one zone only. The server first sends `{"type":"subscribed","zoneId":...}`, then one frame per transition:

```json
{ "type": "enter", "zoneId": "z1", "entityId": "courier-17", "lat": 40.758, "lon": -73.9855, "ts": 1760000000000 }
{ "type": "exit",  "zoneId": "z1", "entityId": "courier-17", "lat": 40.700, "lon": -73.9855, "ts": 1760000004000 }
```

`exit` carries a `reason` when no movement caused it: `expired` (the entity stopped reporting) or `removed` (it was deleted). Each subscriber has a bounded buffer; a subscriber that cannot keep up loses events, which are counted in `eventsDropped`, rather than slowing ingest.

## Health and metrics

| Path | Content |
| --- | --- |
| `GET /health` | Status, index size, queue depth |
| `GET /metrics` | JSON snapshot: index size, queue depth, throughput, and count, mean, p50, p95, p99, max for update, nearest, radius-query and queue-wait latency |
| `GET /metrics/prometheus` | The same meters in Prometheus text format |

The service also prints a one-line summary to the console every `GEOINDEX_REPORT_INTERVAL_SECONDS` (default 10).

## Configuration

Set through environment variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEOINDEX_PORT` / `GEOINDEX_HOST` | `7070` / `0.0.0.0` | Listen address |
| `GEOINDEX_INDEX` | `quadtree` | `quadtree`, `grid` or `brute` |
| `GEOINDEX_BOUNDS` | `40.55,-74.30,40.95,-73.70` | `minLat,minLon,maxLat,maxLon` of the covered area |
| `GEOINDEX_GRID_CELL_METERS` | `250` | Grid cell edge |
| `GEOINDEX_QUAD_LEAF_CAPACITY` | `32` | Points per quadtree leaf before it splits |
| `GEOINDEX_QUAD_TILES` | `8` | Quadtree tiles per side; each tile is a lock stripe |
| `GEOINDEX_GRID_STRIPES` | `64` | Grid lock stripes (power of two) |
| `GEOINDEX_TTL_SECONDS` | `300` | Silence after which an entity expires |
| `GEOINDEX_QUEUE_CAPACITY` | `1024` | Ingest queue size in batches |
| `GEOINDEX_INGEST_WORKERS` | `4` | Threads draining the queue |
| `GEOINDEX_MAX_BATCH` | `1000` | Updates per request |
| `GEOINDEX_DEMO` / `GEOINDEX_DEMO_ENTITIES` | `false` / `2000` | Feed random-walking entities for the demo map |
