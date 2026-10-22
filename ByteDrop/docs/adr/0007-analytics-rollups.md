# 0007. Analytics: buffered raw events, idempotent hourly rollups, histogram percentiles

Status: Accepted

## Context

Every delivery request is an event. Writing a row per request would put the database on the hot path, and percentiles cannot
be averaged across hours.

## Decision

1. **Capture.** The delivery route records an event per response (status, bytes, cache outcome, latency, referrer host).
   Events go into an in-memory buffer that is flushed to `delivery_events` every second or at 500 events, in batches.
   Shutdown flushes the buffer.
2. **Rollup.** The `analytics.rollup` job (every minute) recomputes the last three hours from the raw events, replacing those
   hours inside one transaction. Because it recomputes rather than increments, running it twice, late, or by hand changes
   nothing. Each row is keyed by bucket, file kind and hour and holds requests, bytes, cache hits and misses, the exact p95
   for that hour, a latency histogram (fixed bounds from 5 ms to 10 s), and the top ten files and referrers.
3. **Query.** The API reads rollup rows only. Series are produced hourly, or daily for ranges over 72 hours; totals sum the
   histograms and compute the percentile from the merged histogram, interpolating inside the bucket. Top files and referrers
   are merged across rows. Ranges are capped at 90 days.
4. **Retention.** Raw events are pruned after seven days by the maintenance job; rollups stay.

## Consequences

- The hot path pays for one `push` onto an array.
- Dashboard queries touch at most `days × 24 × buckets × kinds` small rows.
- Percentiles over long ranges are estimates (bounded by the histogram resolution), and the p95 of a single hour is exact.
- Hours older than the rollup window are never recomputed, so the raw-event retention only needs to cover that window plus
  operational slack.
- Up to one second of events is lost if the process is killed without warning. For usage analytics that is acceptable.

## Alternatives considered

- **Increment counters per request.** Hot rows contend on locks and cannot be repaired after a bug.
- **Store only an exact p95 per hour.** Cannot be combined across hours or filters.
