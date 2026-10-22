import { createHash, randomUUID } from "node:crypto";
import { open, rm, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { UPLOAD_CHUNK_SIZE, type StoredObject, type UploadSession } from "@bytedrop/shared";
import type { AppContext } from "../context";
import { blobs, buckets, objects, projects, uploadSessions } from "../db/schema";
import { HttpError, hashFile } from "../util";
import { commitObject, emitEvent, toStoredObject } from "./objects";

type SessionRow = typeof uploadSessions.$inferSelect;

const busy = new Set<string>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const uploadTmp = (ctx: AppContext, id: string) => ctx.storage.tempPath(`upload-${id}`);

export function toSession(row: SessionRow, bucket: string, object: StoredObject | null): UploadSession {
  return {
    id: row.id,
    key: row.key,
    bucket,
    size: row.size,
    offset: row.offset,
    chunkSize: UPLOAD_CHUNK_SIZE,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    object,
  };
}

export async function createUpload(
  ctx: AppContext,
  input: { projectId: string; bucketId: string; bucketName: string; key: string; size: number; sha256: string; contentType: string },
): Promise<UploadSession> {
  const [project] = await ctx.db.select().from(projects).where(eq(projects.id, input.projectId));
  if (!project) throw new HttpError(404, "project_not_found", "Project not found");
  if (project.usedBytes + input.size > project.quotaBytes) {
    throw new HttpError(413, "quota_exceeded", "Project storage quota exceeded");
  }

  const [row] = await ctx.db
    .insert(uploadSessions)
    .values({
      bucketId: input.bucketId,
      projectId: input.projectId,
      key: input.key,
      contentType: input.contentType,
      size: input.size,
      sha256: input.sha256,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .returning();
  const session = row!;
  const tmp = uploadTmp(ctx, session.id);

  // Content already stored (or an empty file): nothing to transfer.
  const [known] = await ctx.db.select().from(blobs).where(eq(blobs.hash, input.sha256));
  const dedupe = known && known.size === input.size && (await ctx.storage.exists(input.sha256));
  if (dedupe || input.size === 0) {
    if (input.size === 0) await writeFile(tmp, "");
    const done = await finalize(ctx, session, input.bucketName, tmp, input.sha256);
    return done;
  }
  await writeFile(tmp, "");
  return toSession(session, input.bucketName, null);
}

async function failUpload(ctx: AppContext, session: SessionRow, bucket: string, reason: string) {
  await ctx.db.transaction(async (tx) => {
    await tx.update(uploadSessions).set({ status: "failed" }).where(eq(uploadSessions.id, session.id));
    await emitEvent(tx, session.projectId, "upload.failed", {
      uploadId: session.id,
      bucket,
      key: session.key,
      reason,
    });
  });
  ctx.metrics.uploadFailures.inc({ reason });
  await rm(uploadTmp(ctx, session.id), { force: true });
}

async function finalize(
  ctx: AppContext,
  session: SessionRow,
  bucketName: string,
  tmp: string,
  knownHash?: string,
): Promise<UploadSession> {
  const actual = knownHash ?? (await hashFile(tmp));
  if (actual !== session.sha256) {
    await failUpload(ctx, session, bucketName, "hash_mismatch");
    throw new HttpError(422, "hash_mismatch", "Assembled file does not match the declared sha256");
  }
  let stored: StoredObject;
  try {
    stored = await commitObject(ctx, {
      bucket: { id: session.bucketId, name: bucketName, projectId: session.projectId },
      key: session.key,
      tmpFile: tmp,
      hash: actual,
      size: session.size,
      contentType: session.contentType,
    });
  } catch (err) {
    if (err instanceof HttpError) await failUpload(ctx, session, bucketName, err.code);
    throw err;
  } finally {
    await rm(tmp, { force: true });
  }
  const [updated] = await ctx.db
    .update(uploadSessions)
    .set({ status: "complete", offset: session.size })
    .where(eq(uploadSessions.id, session.id))
    .returning();
  return toSession(updated!, bucketName, stored);
}

export async function loadSession(ctx: AppContext, projectId: string, id: string) {
  const [row] = await ctx.db
    .select({ session: uploadSessions, bucket: buckets.name })
    .from(uploadSessions)
    .innerJoin(buckets, eq(buckets.id, uploadSessions.bucketId))
    .where(and(eq(uploadSessions.id, id), eq(uploadSessions.projectId, projectId)));
  if (!row) throw new HttpError(404, "upload_not_found", "Upload session not found");
  return row;
}

export async function sessionView(ctx: AppContext, projectId: string, id: string): Promise<UploadSession> {
  const { session, bucket } = await loadSession(ctx, projectId, id);
  let object: StoredObject | null = null;
  if (session.status === "complete") {
    const [o] = await ctx.db
      .select()
      .from(objects)
      .where(and(eq(objects.bucketId, session.bucketId), eq(objects.key, session.key)));
    object = o ? toStoredObject(o) : null;
  }
  return toSession(session, bucket, object);
}

export async function appendChunk(
  ctx: AppContext,
  projectId: string,
  id: string,
  offset: number,
  chunkSha: string,
  chunk: Buffer,
): Promise<UploadSession> {
  const { session, bucket } = await loadSession(ctx, projectId, id);
  if (session.status !== "active") throw new HttpError(409, "upload_closed", `Upload is ${session.status}`);
  if (session.expiresAt < new Date()) throw new HttpError(410, "upload_expired", "Upload session expired");
  if (offset !== session.offset) {
    throw new HttpError(409, "offset_mismatch", "Offset does not match the server", { "upload-offset": String(session.offset) }, {
      currentOffset: session.offset,
    });
  }
  if (offset + chunk.length > session.size) throw new HttpError(400, "chunk_too_large", "Chunk runs past the declared size");
  if (createHash("sha256").update(chunk).digest("hex") !== chunkSha) {
    ctx.metrics.uploadFailures.inc({ reason: "chunk_hash_mismatch" });
    throw new HttpError(422, "chunk_hash_mismatch", "Chunk sha256 does not match X-Chunk-Sha256");
  }
  if (busy.has(id)) throw new HttpError(409, "upload_busy", "Another chunk for this upload is in flight");
  busy.add(id);
  try {
    const tmp = uploadTmp(ctx, id);
    const fh = await open(tmp, "r+");
    try {
      await fh.truncate(offset);
      await fh.write(chunk, 0, chunk.length, offset);
    } finally {
      await fh.close();
    }
    const next = offset + chunk.length;
    const moved = await ctx.db
      .update(uploadSessions)
      .set({ offset: next })
      .where(and(eq(uploadSessions.id, id), eq(uploadSessions.offset, offset)))
      .returning();
    if (moved.length === 0) throw new HttpError(409, "offset_mismatch", "Concurrent update", {}, { currentOffset: offset });
    if (next === session.size) return await finalize(ctx, moved[0]!, bucket, tmp);
    return toSession(moved[0]!, bucket, null);
  } finally {
    busy.delete(id);
  }
}

export async function cancelUpload(ctx: AppContext, projectId: string, id: string) {
  const { session } = await loadSession(ctx, projectId, id);
  if (session.status === "active") {
    await ctx.db.update(uploadSessions).set({ status: "cancelled" }).where(eq(uploadSessions.id, id));
  }
  await rm(uploadTmp(ctx, id), { force: true });
}

export const newUploadId = randomUUID;
