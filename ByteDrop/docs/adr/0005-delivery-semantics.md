# 0005. Delivery behaves like a CDN origin

Status: Accepted

## Context

`GET /f/{bucket}/{key}` is the hot path. It sits behind browsers, video players and, eventually, a real CDN, so its
headers decide how much work ever reaches the server.

## Decision

- **Validators.** A strong `ETag` derived from the blob hash (`"t-…"` plus the parameters for transformed images).
  `If-None-Match` supports lists, weak tags and `*`, and answers `304` without reading the file. A transformed variant is
  answered with `304` without rendering it, because its ETag is computable from the request alone.
- **Ranges.** Single `Range` requests return `206` with `Content-Range`; open-ended and suffix forms work; an end past the
  file is clamped; an unsatisfiable start returns `416`. `If-Range` falls back to a full response when the tag is stale.
  Multiple ranges are served as a full response, which the specification allows.
- **Headers.** `Cache-Control` (`public` with a five-minute lifetime for public buckets, `private` for private ones),
  `Content-Type`, `Content-Disposition` (`?download` switches to attachment), `Accept-Ranges`, `Last-Modified`.
- **Private buckets.** Access needs one of: a signed link (`exp` and `sig`, an HMAC over bucket, key and expiry), an API
  key of the same project, or a dashboard session of the project's owner. A wrong signature is `403`, an expired one `410`,
  nothing at all `401`. The signature is checked before the object is looked up, so unauthenticated callers cannot probe
  which keys exist.
- **Transforms.** `?w=&h=&q=&format=&fit=` runs through `sharp`. Results are stored on disk under an LRU keyed by blob hash
  plus parameters, so they never go stale. Concurrent requests for a variant that is not cached yet are **coalesced**: the
  image is rendered once and every waiter gets the result. At most four renders run at the same time.
- **What counts as a cache hit.** The analytics "cache hit rate" is the share of requests that were answered without doing
  work: a `304`, a transform served from the cache (or from another request's render), or a plain file read. A transform
  that had to be rendered is a miss. Errors are excluded from the rate.
- **Small hot data stays in memory.** Bucket and object metadata is held for one second with request collapsing and is
  invalidated immediately by writes in the same process; files under 512 KB are held in a bounded in-memory LRU. Both exist
  because opening a file and querying the database per request were the two largest costs measured under load.

## Consequences

- Repeat visitors cost almost nothing, and a CDN placed in front can honour the same headers.
- Within one instance a new upload or a delete is visible at once; another instance sees a metadata change after at most the
  one-second window (`DELIVERY_META_TTL_MS`).
- Because bucket names are global, a delivery URL needs no project id.

## Alternatives considered

- **Weak ETags from size and mtime.** Cheaper to compute, but unequal for identical content and unsafe for ranges.
- **Rendering transforms in the worker only.** Would lengthen the first request for a new variant; the coalescing keeps the
  cost to one render regardless of the burst.
