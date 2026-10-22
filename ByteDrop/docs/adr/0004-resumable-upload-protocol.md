# 0004. Resumable uploads: server-owned offset, per-chunk and whole-file hashes

Status: Accepted

## Context

Large uploads fail halfway: laptops sleep, Wi-Fi drops, tabs close. The client must be able to continue instead of
starting again, and the server must never publish a file that is not byte-for-byte what the client intended.

## Decision

A small protocol in the style of tus, built on plain HTTP:

1. `POST /v1/projects/:id/buckets/:bucket/uploads` with `{ key, size, sha256, contentType }` creates a session. The
   whole-file hash is declared up front, so the client hashes first (in a Web Worker).
2. `PATCH .../uploads/:uploadId` sends one chunk with `Upload-Offset` and `X-Chunk-Sha256` headers. The server checks that
   the offset equals its own, verifies the chunk hash, writes the bytes at that offset, then advances the offset with a
   compare-and-set (`UPDATE ... WHERE offset = old`).
3. `GET .../uploads/:uploadId` returns the current offset. This is what a client calls after any failure or refresh.
4. When the offset reaches the declared size the server hashes the assembled file. Only if it matches the declared SHA-256
   is the object committed. Otherwise the session is marked failed and an `upload.failed` event is emitted.

Rules that make it safe to retry: a chunk at the wrong offset gets `409` plus the offset the server holds; a corrupted chunk
gets `422` and does not move the offset; the file is truncated to the offset before each write so a torn earlier write
cannot leak into the result; only one chunk per session is in flight.

The browser queue stores the `File` itself in IndexedDB together with its session id, so after a refresh it asks the server
for the offset and carries on. The server is always the source of truth for how much it has.

Sessions expire after 24 hours; the maintenance job marks stale ones failed, emits the event and removes scratch files.

## Consequences

- Any interruption costs at most one chunk (1 MiB by default).
- The client does a full read of the file before sending anything. That is the price of declaring the hash first; it also
  enables instant completion for content the server already holds.
- Chunks are sequential per upload. Parallel chunks would be faster on fat links but complicate offsets; two files upload
  in parallel instead.

## Alternatives considered

- **S3-style multipart with presigned parts.** Needs an object store and per-part bookkeeping in the client.
- **tus itself.** A fine choice; this project implements the part it needs so the hash checks and quota can sit in the same
  transaction as the commit.
