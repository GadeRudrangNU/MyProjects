import { and, asc, desc, eq, ilike, like, sql, type SQL } from "drizzle-orm";
import { fileKindOf, type ListObjectsQuery, type StoredObject, type WebhookEvent } from "@bytedrop/shared";
import type { AppContext } from "../context";
import type { Db } from "../db/client";
import { blobs, buckets, objects, outbox, projects } from "../db/schema";
import { Q } from "../jobs/queues";
import { injectTrace } from "../telemetry";
import { HttpError, decodeCursor, encodeCursor, likeEscape } from "../util";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function emitEvent(tx: Tx, projectId: string, type: WebhookEvent, payload: unknown) {
  await tx.insert(outbox).values({ projectId, eventType: type, payload, trace: injectTrace() });
}

type ObjectRow = typeof objects.$inferSelect;

export function toStoredObject(row: ObjectRow): StoredObject {
  return {
    key: row.key,
    size: row.size,
    contentType: row.contentType,
    kind: fileKindOf(row.contentType),
    etag: `"${row.blobHash.slice(0, 32)}"`,
    sha256: row.blobHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface BucketRef {
  id: string;
  name: string;
  projectId: string;
}

export async function releaseBlob(tx: Tx, hash: string) {
  await tx
    .update(blobs)
    .set({
      refCount: sql`${blobs.refCount} - 1`,
      zeroSince: sql`case when ${blobs.refCount} - 1 <= 0 then now() else null end`,
    })
    .where(eq(blobs.hash, hash));
}

export interface CommitInput {
  bucket: BucketRef;
  key: string;
  tmpFile: string;
  hash: string;
  size: number;
  contentType: string;
}

/**
 * Atomically registers an uploaded file: blob refcount, object row, quota accounting and the
 * outbox event all happen in one transaction.
 */
export async function commitObject(ctx: AppContext, input: CommitInput): Promise<StoredObject> {
  const { bucket, key, hash, size, contentType } = input;
  const row = await ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(objects)
      .where(and(eq(objects.bucketId, bucket.id), eq(objects.key, key)))
      .for("update");

    const delta = size - (existing?.size ?? 0);
    const updated = await tx
      .update(projects)
      .set({ usedBytes: sql`${projects.usedBytes} + ${delta}` })
      .where(and(eq(projects.id, bucket.projectId), sql`${projects.usedBytes} + ${delta} <= ${projects.quotaBytes}`))
      .returning({ id: projects.id });
    if (updated.length === 0) {
      throw new HttpError(413, "quota_exceeded", "Project storage quota exceeded");
    }

    const sameBlob = existing?.blobHash === hash;
    if (!sameBlob) {
      await tx
        .insert(blobs)
        .values({ hash, size, refCount: 1 })
        .onConflictDoUpdate({
          target: blobs.hash,
          set: { refCount: sql`${blobs.refCount} + 1`, zeroSince: null },
        });
      await ctx.storage.put(input.tmpFile, hash);
    }

    const now = new Date();
    let saved: ObjectRow | undefined;
    if (existing) {
      [saved] = await tx
        .update(objects)
        .set({ blobHash: hash, size, contentType, kind: fileKindOf(contentType), updatedAt: now })
        .where(eq(objects.id, existing.id))
        .returning();
      if (!sameBlob) await releaseBlob(tx, existing.blobHash);
    } else {
      [saved] = await tx
        .insert(objects)
        .values({ bucketId: bucket.id, key, blobHash: hash, size, contentType, kind: fileKindOf(contentType) })
        .returning();
    }
    const stored = toStoredObject(saved!);
    await emitEvent(tx, bucket.projectId, "object.created", { bucket: bucket.name, object: stored });
    return saved!;
  });

  ctx.deliveryMeta.invalidate(bucket.name, key);
  if (row.kind === "image") {
    await ctx.jobs
      .send(Q.thumbnail, { blobHash: hash, contentType })
      .catch((err) => ctx.log.warn({ err }, "failed to enqueue thumbnail job"));
  }
  return toStoredObject(row);
}

export async function deleteObject(ctx: AppContext, bucket: BucketRef, key: string): Promise<boolean> {
  ctx.deliveryMeta.invalidate(bucket.name, key);
  const deleted = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(objects)
      .where(and(eq(objects.bucketId, bucket.id), eq(objects.key, key)))
      .returning();
    if (!row) return false;
    await releaseBlob(tx, row.blobHash);
    await tx
      .update(projects)
      .set({ usedBytes: sql`greatest(${projects.usedBytes} - ${row.size}, 0)` })
      .where(eq(projects.id, bucket.projectId));
    await emitEvent(tx, bucket.projectId, "object.deleted", { bucket: bucket.name, key });
    return true;
  });
  ctx.deliveryMeta.invalidate(bucket.name, key);
  return deleted;
}

export async function listObjects(db: Db, bucketId: string, q: ListObjectsQuery) {
  const col = q.sort === "name" ? objects.key : q.sort === "size" ? objects.size : objects.createdAt;
  const conds: SQL[] = [eq(objects.bucketId, bucketId)];
  if (q.prefix) conds.push(like(objects.key, `${likeEscape(q.prefix)}%`));
  if (q.q) conds.push(ilike(objects.key, `%${likeEscape(q.q)}%`));
  if (q.kind) conds.push(eq(objects.kind, q.kind));

  if (q.cursor) {
    const [v, k] = decodeCursor<[string | number, string]>(q.cursor);
    const cmp = q.dir === "asc" ? sql`>` : sql`<`;
    if (q.sort === "name") {
      conds.push(sql`${objects.key} ${cmp} ${String(k)}`);
    } else if (q.sort === "size") {
      conds.push(sql`(${objects.size}, ${objects.key}) ${cmp} (${Number(v)}, ${String(k)})`);
    } else {
      conds.push(sql`(${objects.createdAt}, ${objects.key}) ${cmp} (${new Date(String(v))}, ${String(k)})`);
    }
  }

  const order = q.dir === "asc" ? asc : desc;
  const rows = await db
    .select()
    .from(objects)
    .where(and(...conds))
    .orderBy(order(col), order(objects.key))
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  let nextCursor: string | null = null;
  if (rows.length > q.limit && last) {
    const v = q.sort === "name" ? last.key : q.sort === "size" ? last.size : last.createdAt.toISOString();
    nextCursor = encodeCursor([v, last.key]);
  }
  return { items: page.map(toStoredObject), nextCursor };
}

export async function findBucket(db: Db, projectId: string, name: string) {
  const [b] = await db
    .select()
    .from(buckets)
    .where(and(eq(buckets.projectId, projectId), eq(buckets.name, name)))
    .limit(1);
  if (!b) throw new HttpError(404, "bucket_not_found", `Bucket "${name}" not found`);
  return b;
}
