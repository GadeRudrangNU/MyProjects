# 0003. Content-addressed blobs with reference counts and delayed garbage collection

Status: Accepted

## Context

People upload the same file many times: the same logo into ten buckets, the same export every night. Storing every copy
wastes disk, and per-file IDs make it impossible to tell whether two files are identical without reading them.

## Decision

Every stored file is a **blob** named by its SHA-256 (`blobs/ab/cd/<hash>`). An **object** (a key in a bucket) points at a
blob. The `blobs` table keeps a `ref_count`.

- Uploading identical content again adds a reference and writes nothing. The resumable-upload endpoint even completes the
  session immediately when the declared hash is already stored.
- Overwriting a key moves the reference from the old blob to the new one; deleting a key releases it. All of this happens in
  the same transaction as the object row, the project's byte counter and the outbox event.
- A blob whose count reaches zero gets a `zero_since` timestamp. The `maintenance.gc` job deletes blobs that have been at
  zero for longer than a grace period (five minutes by default).
- The garbage collector locks the blob row (`FOR UPDATE SKIP LOCKED`), deletes the file, then deletes the row. An upload of
  the same content has to take the same row lock, so one of them waits for the other and the file is never removed from
  under a live reference. There is a test for exactly that interleaving.
- The ETag of a file is derived from the blob hash, so identical content shares a validator.

Quota counts logical bytes per project (what the customer sees), not deduplicated disk usage.

## Consequences

- Deduplication, integrity checking and cache keys all come from one value.
- Deletes are cheap and recoverable for a few minutes, which also protects against a client that deletes and re-uploads.
- Disk is released lazily. The runbook has a command to inspect and force a collection.
- A crash between writing a file and committing the transaction can leave an orphan file with no row. It is harmless and
  small; a periodic sweep of `blobs/` against the table is the follow-up if it ever matters.

## Alternatives considered

- **Per-object files.** Simple, but no deduplication and no cheap equality.
- **Delete immediately at zero.** Races with a concurrent upload of the same content; the grace period and row lock close
  that window.
