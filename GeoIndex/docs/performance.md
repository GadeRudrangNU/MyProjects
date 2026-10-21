# Performance report

At 1 million points, nearest-10 p99 went from **69.84 ms** with a full scan to **76.3 µs** with the quadtree (JMH, 915x), and from **70.1 ms** to **481 µs** under a mixed load of concurrent updates and queries (HdrHistogram, open-loop, 146x). Profiling that mixed load found that radius queries were spending most of their time on duplicate handling that only matters while a move overlaps the read; removing it from the common path cut radius-query p50 about 3x and p99 about 2x. What remains of the tail is garbage-collection pauses, covered below.

## Conditions

| | |
| --- | --- |
| Data | Synthetic only. A fixed-seed (42) mixture of 40 Gaussian hot spots with log-normal popularity plus a 10% uniform background, inside a 44 km by 51 km box around New York City. Entities move by a random walk of about 25 m per update. Query points follow the same distribution as the data. |
| Machine | 16 logical cores, 15.6 GB RAM, Windows 11, Oracle JDK 23 (the code targets Java 17) |
| JVM | Parallel collector with a 1 GB young generation unless a table says otherwise. JMH: 6 GB heap, 3 warmup and 5 measured 1 s iterations, 1 fork. Load tests: 2 GB initial and 6 GB maximum heap |
| Indexes | Grid with 250 m cells and 64 lock stripes; quadtree with 32 points per leaf, 64 tiles (one lock stripe each) |
| Raw results | `docs/results/` holds the JMH JSON, every load-test JSON and both profiles |

Load tests are in-process (they call the service core, so HTTP cost is excluded), open-loop and recorded with HdrHistogram. Each operation type runs on its own worker threads (2 for updates, 4 for nearest, 2 for radius queries). Every operation is scheduled for a fixed instant and its latency is measured from that instant, so a pause delays everything queued behind it in the numbers instead of being hidden. Workers spin through the last 20 ms before an operation is due because Windows timers oversleep by milliseconds, which would otherwise be counted as latency.

## Microbenchmarks (JMH, SampleTime, single thread)

Nearest 10, p50 / p99:

| Index | 10k p50 / p99 | 100k p50 / p99 | 1M p50 / p99 |
| --- | --- | --- | --- |
| Brute force | 246.7 µs / 534.5 µs | 4.62 ms / 7.03 ms | 47.35 ms / 69.84 ms |
| Grid | 6.10 µs / 32.1 µs | 9.39 µs / 75.4 µs | 30.1 µs / 489.7 µs |
| Quadtree | 9.09 µs / 36.0 µs | 12.7 µs / 64.5 µs | 19.4 µs / 76.3 µs |

Everything within 500 m, p50 / p99. In the dense cores of the synthetic city this returns thousands of points at 1M, so it is dominated by result handling rather than by finding cells:

| Index | 10k p50 / p99 | 100k p50 / p99 | 1M p50 / p99 |
| --- | --- | --- | --- |
| Brute force | 233.5 µs / 531.5 µs | 4.63 ms / 8.10 ms | 45.81 ms / 66.97 ms |
| Grid | 4.00 µs / 102.7 µs | 34.5 µs / 1.17 ms | 359.9 µs / 14.88 ms |
| Quadtree | 3.60 µs / 95.7 µs | 36.4 µs / 1.10 ms | 354.3 µs / 12.13 ms |

Move one entity to a nearby position (an update), p50 / p99:

| Index | 10k p50 / p99 | 100k p50 / p99 | 1M p50 / p99 |
| --- | --- | --- | --- |
| Brute force | 0.40 µs / 1.10 µs | 0.90 µs / 1.80 µs | 1.20 µs / 2.50 µs |
| Grid | 0.70 µs / 1.60 µs | 1.30 µs / 5.80 µs | 1.90 µs / 15.9 µs |
| Quadtree | 0.90 µs / 2.60 µs | 1.60 µs / 7.40 µs | 3.00 µs / 16.1 µs |

Eight threads, 90% nearest-10 and 10% moves, operations per millisecond (higher is better):

| Index | 10k | 100k | 1M |
| --- | --- | --- | --- |
| Brute force | 13 | 1 | 0 |
| Grid | 205 | 351 | 139 |
| Quadtree | 384 | 357 | 266 |

At 1M points the quadtree answers nearest-10 in 19.4 µs at the median and 76.3 µs at p99. The grid reaches 30.1 µs and 489.7 µs: with fixed 250 m cells, the crowded cells hold hundreds of points and every query that lands in one scans all of them, whereas the quadtree keeps its leaves at about 32 points everywhere. Under eight threads of mixed load the quadtree sustains 266 operations per millisecond against 139 for the grid.

## Mixed load across index types

Updates 5,000 per second in batches of 50, nearest 500 per second, radius queries 50 per second, 15 s measured after 8 s of warmup:

| Points | Index | nearest p50 | nearest p99 | radius p50 | radius p99 | update batch p99 |
| --- | --- | --- | --- | --- | --- | --- |
| 10,000 | Brute force | 444 µs | 851 µs | 486 µs | 1.04 ms | 406 µs |
| 10,000 | Grid | 44 µs | 156 µs | 55 µs | 433 µs | 380 µs |
| 10,000 | Quadtree | 49 µs | 195 µs | 57 µs | 517 µs | 473 µs |
| 100,000 | Brute force | 4.29 ms | 8.05 ms | 5.90 ms | 9.18 ms | 279 µs |
| 100,000 | Grid | 52 µs | 254 µs | 119 µs | 2.64 ms | 445 µs |
| 100,000 | Quadtree | 51 µs | 161 µs | 114 µs | 2.67 ms | 706 µs |
| 1,000,000 | Brute force | saturated | saturated | saturated | saturated | 342 µs |
| 1,000,000 | Grid | 95 µs | 1.30 ms | 759 µs | 26.8 ms | 753 µs |
| 1,000,000 | Quadtree | 56 µs | 161 µs | 701 µs | 21.8 ms | 3.49 ms |

The brute-force index is the baseline and the test oracle. Its update cost is flat (a hash-map write), but a query scans every point: at 1M points one nearest query takes tens of milliseconds, so at 500 queries per second the schedule falls behind permanently and the run is marked saturated (its open-loop latency is just the growing backlog, not a per-query time). Both spatial indexes hold sub-millisecond nearest p99 at 1M points.

The same 1M-point comparison at rates the brute-force index can sustain (updates 5,000 per second in batches of 50, nearest 40 per second, radius queries 4 per second, 20 s measured after 8 s of warmup):

| Index | nearest p50 | nearest p99 | radius p50 | radius p99 | update batch p99 |
| --- | --- | --- | --- | --- | --- |
| Brute force | 42.6 ms | 70.1 ms | 42.0 ms | 83.4 ms | 426 µs |
| Grid | 191 µs | 1.31 ms | 1.58 ms | 24.2 ms | 728 µs |
| Quadtree | 117 µs | 481 µs | 1.18 ms | 22.4 ms | 828 µs |

## Finding the hotspot and fixing it

Starting point: 1M points, 20,000 updates per second in batches of 100, 300 radius queries and 3,000 nearest queries per second. Radius-query latency was far worse than everything else, so the run was recorded with Java Flight Recorder (`./gradlew profile`, `./gradlew hotspots`; full output in `docs/results/profile-before-fix.txt`):

| Where the CPU went (self time) | Share |
| --- | --- |
| `ConcurrentHashMap.get` | 28.0% |
| `TimSort` (merge, sort of results) | 30.7% |
| `rankedNeighbors` | 10.7% |

Attributed to the nearest project method on the stack, `rankedNeighbors` accounted for 46% of the samples and `StripedIndex.isCurrent` for 31%. Both exist for the same reason. A move publishes the new copy of an entity before retiring the old one so that readers never miss it, which means a read that overlaps a move can briefly see two copies. Radius queries guarded against that on every hit (one hash lookup per hit, thousands per query in dense areas) and rebuilt a `HashMap` of the whole result to drop duplicates.

The fix: the index counts moves in flight and moves completed. A reader notes both before scanning and checks them afterwards. If no move overlapped the scan, duplicates cannot exist and both the per-hit lookup and the duplicate pass are skipped; if one did, the result goes through the existing duplicate removal. Correctness is unchanged and covered by the equivalence and concurrency tests.

Same workload before and after, two runs each, shown as run 1 / run 2:

| Index | Operation | Before p50 | After p50 | Before p99 | After p99 |
| --- | --- | --- | --- | --- | --- |
| Quadtree | radius 500 m | 2.82 ms / 2.56 ms | 880 µs / 933 µs | 54.4 ms / 60.8 ms | 29.0 ms / 32.4 ms |
| Quadtree | nearest 10 | 43 µs / 44 µs | 42 µs / 42 µs | 11.0 ms / 10.6 ms | 3.91 ms / 6.06 ms |
| Quadtree | update batch (100) | 675 µs / 661 µs | 542 µs / 564 µs | 22.2 ms / 21.3 ms | 6.14 ms / 9.64 ms |
| Grid | radius 500 m | 3.95 ms / 4.56 ms | 982 µs / 1.06 ms | 75.9 ms / 67.8 ms | 41.6 ms / 36.1 ms |
| Grid | nearest 10 | 77 µs / 76 µs | 73 µs / 73 µs | 2.92 ms / 3.93 ms | 11.4 ms / 6.38 ms |
| Grid | update batch (100) | 514 µs / 510 µs | 433 µs / 424 µs | 5.69 ms / 7.34 ms | 11.6 ms / 7.17 ms |

Radius queries improved about 3x at the median and about 2x at p99 for both indexes. The nearest and update rows show no consistent change between before and after; their p99 moves between runs because it is set by collector pauses, not by the index. The profile after the change (`docs/results/profile-after-fix.txt`, with the load generator's own pacing excluded) no longer shows `ConcurrentHashMap.get` or `isCurrent`. The next candidate is the sort of large radius results (`rankedNeighbors` is still the largest project frame at 36% of the remaining samples), followed by the object allocation per hit.

## The remaining tail is garbage collection

With the index no longer in the way, p99.9 and the maximum were nearly identical for updates, nearest and radius queries (about 30 to 50 ms for all three), which points at something that stops every thread at once. A GC log of the same run showed young collections with a median pause of about 29 ms. The live set is a million small objects that updates keep replacing, so each young collection has a lot of old-to-young references to scan. Same workload, two runs each, run 1 / run 2:

| Collector | nearest p99 | nearest p99.9 | radius p99 | update batch p99 |
| --- | --- | --- | --- | --- |
| Parallel, default young generation | 2.61 ms / 6.72 ms | 32.9 ms / 34.3 ms | 27.4 ms / 30.0 ms | 5.84 ms / 9.11 ms |
| Parallel, 1 GB young generation | 1.75 ms / 823 µs | 52.8 ms / 40.2 ms | 31.9 ms / 30.0 ms | 4.93 ms / 4.80 ms |
| G1 | 14.9 ms / 15.6 ms | 47.3 ms / 46.8 ms | 51.0 ms / 51.4 ms | 19.5 ms / 18.6 ms |
| ZGC | 10.3 ms / 627 µs | 25.9 ms / 4.18 ms | 621.3 ms / 59.1 ms | 16.5 ms / 6.98 ms |

A larger young generation makes collections less frequent and brings nearest p99 down to the sub-2 ms range, so it is the default for `run`, `loadTest` and `profile`. It does not shorten an individual pause, which is why p99.9 stays at 30 to 50 ms. G1 was worse across the board. ZGC trades pause length for load-barrier cost: its nearest tail was the best in one run, but its radius-query tail, which walks many objects, was the worst and varied widely between runs. Reducing allocation per query (result objects, boxed doubles, sort buffers) is the remaining lever.

## Reproducing

```bash
./gradlew jmh                                    # microbenchmarks
./gradlew loadTest -PloadArgs="--points 1000000 --index quadtree --duration 20 --warmup 10 --update-rate 20000 --batch 100 --nearest-rate 3000 --within-rate 300"
./gradlew profile -PloadArgs="--points 1000000 --index quadtree --duration 20 --warmup 8 --update-rate 20000 --batch 100 --nearest-rate 3000 --within-rate 300"
./gradlew hotspots
```

See [development.md](development.md) for every option.
