# Building, running and measuring

Requires a JDK 17 or newer (CI uses 21). Everything is driven by the Gradle wrapper; there is no database and no container.

## Run the service

```bash
./gradlew run
```

Open `http://localhost:7070` for the demo map. To feed it moving entities:

```bash
GEOINDEX_DEMO=true ./gradlew run
```

On Windows PowerShell: `$env:GEOINDEX_DEMO = "true"; .\gradlew.bat run`.

## Tests and coverage

```bash
./gradlew check
```

Runs the unit, property, concurrency, backpressure and API tests, then enforces 85% instruction coverage with JaCoCo. The report is in `build/reports/jacoco/test/html/index.html`. The program entry point and the JFR summariser (`io.geoindex.tools`) are excluded from the gate because they are thin launchers.

| Suite | What it checks |
| --- | --- |
| `IndexEquivalenceProperties` | jqwik: grid and quadtree return exactly the brute-force results for nearest and radius queries over random, clustered and duplicate-heavy inputs, through random sequences of moves, stale updates and removals; removing everything leaves an empty index |
| `ConcurrencyStressTest` | Many writers and readers in parallel; reads stay well-formed and never miss an entity that is not moving; the final contents equal what was written; competing writers on the same ids leave the newest report |
| `GeoServiceTest`, `ApiTest` | Validation, backpressure (429, then recovery once workers run), zone enter and exit events, expiry, WebSocket delivery |
| `GeoTest` | The distance approximation stays within 0.5% of haversine across the covered area |

## Benchmarks

Microbenchmarks (JMH) time nearest-10, radius-500 m and move at 10 thousand, 100 thousand and 1 million points for each index, plus a multi-threaded mixed read and write benchmark:

```bash
./gradlew jmh                                  # everything, a few minutes
./gradlew jmh -PbenchInclude='IndexBenchmarks.nearest10'
```

Results land in `build/reports/jmh/results.json`.

## Load generator

Open-loop: operations run on a fixed schedule and each latency is measured from when the operation was due, so a stall is not hidden (no coordinated omission). Latencies are recorded in HdrHistogram. Each operation type has its own worker threads.

```bash
./gradlew loadTest -PloadArgs="--points 1000000 --index quadtree --duration 20 --warmup 10 --update-rate 20000 --batch 100 --nearest-rate 3000 --within-rate 300 --out build/results/run.json"
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--target` | `inprocess` | `inprocess` calls the service core directly; `http` drives a running server at `--url` |
| `--index` | `quadtree` | `brute`, `grid` or `quadtree` (in-process only) |
| `--points` | `100000` | Entities preloaded before the run |
| `--update-rate`, `--batch` | `10000`, `100` | Position updates per second and updates per request |
| `--nearest-rate`, `--within-rate` | `2000`, `200` | Queries per second |
| `--update-threads`, `--nearest-threads`, `--within-threads` | `2`, `4`, `2` | Workers per operation type |
| `--k`, `--radius` | `10`, `500` | Nearest-k size and radius-query meters |
| `--duration`, `--warmup` | `20`, `5` | Seconds measured and discarded |
| `--dataset`, `--file` | `synthetic` | `csv` loads real coordinates from a file with a header row and `lat`/`lon` columns |
| `--out` | none | Write the JSON report |

Run it against a live server: start the service with larger limits (`GEOINDEX_QUEUE_CAPACITY=8192`), then `--target http --url http://localhost:7070`.

JVM flags for `run`, `loadTest` and `profile` come from `-Pgc="..."` (default `-XX:+UseParallelGC -Xmn1g`) and `-PjvmExtra="..."`.

## Profiling

```bash
./gradlew profile -PloadArgs="--points 1000000 --duration 20 --warmup 8"   # writes build/profile/geoindex.jfr
./gradlew hotspots                                                          # top frames, project callers, allocation
```

The `.jfr` file also opens in JDK Mission Control.

## Datasets

The synthetic generator is a fixed-seed mixture of 40 Gaussian hot spots with log-normal popularity and a 10% uniform background inside a 44 km by 51 km box, with a random-walk step for movement. Real coordinates (OpenStreetMap merchant exports, historic taxi pickups) load from CSV with `--dataset csv --file <path>`; rows outside the bounds or without parseable coordinates are skipped.
