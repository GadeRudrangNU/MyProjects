import { UPLOAD_CHUNK_SIZE, type UploadSession } from "@bytedrop/shared";
import { ApiError } from "../api/client";
import type { Api } from "../api/endpoints";
import type { Hasher, UploadItem, UploadStore } from "./types";

interface Entry {
  item: UploadItem;
  file: Blob;
  abort: AbortController | null;
}

export interface ManagerDeps {
  api: Pick<Api, "createUpload" | "uploadStatus" | "cancelUpload">;
  hasher: Hasher;
  store: UploadStore;
  fetchImpl?: typeof fetch;
  concurrency?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
  onComplete?: (item: UploadItem) => void;
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Chunked, resumable upload queue. The server is the source of truth for how many bytes it holds, so every
 * start, resume and retry asks for the current offset first and continues from there.
 */
export class UploadManager {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private snap: UploadItem[] = [];
  private readonly concurrency: number;
  private readonly retryDelayMs: number;
  private readonly maxAttempts: number;

  constructor(private readonly deps: ManagerDeps) {
    this.concurrency = deps.concurrency ?? 2;
    this.retryDelayMs = deps.retryDelayMs ?? 600;
    this.maxAttempts = deps.maxAttempts ?? 4;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private emit() {
    this.snap = [...this.entries.values()].map((e) => ({ ...e.item })).sort((a, b) => a.createdAt - b.createdAt);
    this.listeners.forEach((l) => l());
  }

  private update(e: Entry, patch: Partial<UploadItem>, persist = false) {
    Object.assign(e.item, patch);
    if (persist) void this.deps.store.save(e.item, e.file);
    this.emit();
  }

  /** Reloads items saved before a page refresh and continues the ones that were in flight. */
  async restore() {
    const rows = await this.deps.store.loadAll();
    for (const { item, file } of rows) {
      if (item.status === "done" || item.status === "cancelled") {
        void this.deps.store.remove(item.id);
        continue;
      }
      const wasActive = item.status === "queued" || item.status === "hashing" || item.status === "uploading";
      this.entries.set(item.id, { item: { ...item, status: wasActive ? "queued" : item.status }, file, abort: null });
    }
    this.emit();
    this.pump();
  }

  add(files: File[], target: { projectId: string; bucket: string; prefix?: string }) {
    for (const file of files) {
      const id = crypto.randomUUID();
      const key = `${target.prefix ?? ""}${file.name}`;
      const item: UploadItem = {
        id,
        projectId: target.projectId,
        bucket: target.bucket,
        key,
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        status: "queued",
        hashProgress: 0,
        sent: 0,
        createdAt: Date.now(),
      };
      this.entries.set(id, { item, file, abort: null });
      void this.deps.store.save(item, file);
    }
    this.emit();
    this.pump();
  }

  pause(id: string) {
    const e = this.entries.get(id);
    if (!e || !["queued", "hashing", "uploading"].includes(e.item.status)) return;
    e.abort?.abort();
    this.update(e, { status: "paused" }, true);
  }

  resume(id: string) {
    const e = this.entries.get(id);
    if (!e || (e.item.status !== "paused" && e.item.status !== "error")) return;
    this.update(e, { status: "queued", error: undefined }, true);
    this.pump();
  }

  retry = (id: string) => this.resume(id);

  async cancel(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    e.abort?.abort();
    this.update(e, { status: "cancelled" });
    void this.deps.store.remove(id);
    if (e.item.sessionId) {
      await this.deps.api.cancelUpload(e.item.projectId, e.item.sessionId).catch(() => {});
    }
  }

  clearFinished() {
    for (const [id, e] of this.entries) {
      if (e.item.status === "done" || e.item.status === "cancelled") this.entries.delete(id);
    }
    this.emit();
  }

  private running() {
    return [...this.entries.values()].filter((e) => e.item.status === "hashing" || e.item.status === "uploading").length;
  }

  private pump() {
    for (const e of this.entries.values()) {
      if (this.running() >= this.concurrency) return;
      if (e.item.status === "queued") void this.run(e);
    }
  }

  private async run(e: Entry) {
    const ctrl = new AbortController();
    e.abort = ctrl;
    try {
      if (!e.item.sha256) {
        this.update(e, { status: "hashing", hashProgress: 0 });
        const sha = await this.deps.hasher.hashFile(e.file, (f) => this.update(e, { hashProgress: f }), ctrl.signal);
        this.update(e, { sha256: sha, hashProgress: 1 }, true);
      }
      this.update(e, { status: "uploading" });
      let session = await this.openSession(e, ctrl.signal);
      while (session.status === "active" && session.offset < e.item.size) {
        session = await this.sendChunk(e, session, ctrl.signal);
      }
      if (session.status !== "complete") throw new Error(`Upload ${session.status}`);
      this.update(e, { status: "done", sent: e.item.size });
      void this.deps.store.remove(e.item.id);
      this.deps.onComplete?.({ ...e.item });
    } catch (err) {
      if (isAbort(err) || ctrl.signal.aborted) return;
      this.update(e, { status: "error", error: err instanceof Error ? err.message : "Upload failed" }, true);
    } finally {
      e.abort = null;
      this.pump();
    }
  }

  private async openSession(e: Entry, signal: AbortSignal): Promise<UploadSession> {
    const { item } = e;
    if (item.sessionId) {
      try {
        const s = await this.deps.api.uploadStatus(item.projectId, item.sessionId, signal);
        if (s.status === "active" || s.status === "complete") {
          this.update(e, { sent: s.offset }, true);
          return s;
        }
      } catch (err) {
        if (isAbort(err)) throw err;
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
    }
    const s = await this.deps.api.createUpload(
      item.projectId,
      item.bucket,
      { key: item.key, size: item.size, sha256: item.sha256!, contentType: item.type },
      signal,
    );
    this.update(e, { sessionId: s.id, sent: s.offset }, true);
    return s;
  }

  private async sendChunk(e: Entry, session: UploadSession, signal: AbortSignal): Promise<UploadSession> {
    const { item } = e;
    const size = session.chunkSize || UPLOAD_CHUNK_SIZE;
    let offset = session.offset;
    for (let attempt = 1; ; attempt++) {
      const chunk = e.file.slice(offset, Math.min(offset + size, item.size));
      const sha = await this.deps.hasher.hashChunk(chunk);
      try {
        const res = await (this.deps.fetchImpl ?? fetch)(`/v1/projects/${item.projectId}/uploads/${session.id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/octet-stream", "upload-offset": String(offset), "x-chunk-sha256": sha },
          body: chunk,
          signal,
        });
        if (res.ok) {
          const next = (await res.json()) as UploadSession;
          this.update(e, { sent: next.offset }, true);
          return next;
        }
        const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; currentOffset?: number } } | null;
        if (res.status === 409 && typeof body?.error?.currentOffset === "number") {
          // The server holds a different amount than we thought (for example the response to a chunk was lost).
          this.update(e, { sent: body.error.currentOffset }, true);
          return { ...session, offset: body.error.currentOffset };
        }
        const retryable = res.status >= 500 || res.status === 422 || res.status === 429;
        if (!retryable || attempt >= this.maxAttempts) {
          throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? `Upload failed (${res.status})`);
        }
      } catch (err) {
        if (isAbort(err) || signal.aborted) throw err;
        if (err instanceof ApiError || attempt >= this.maxAttempts) throw err;
      }
      await sleep(this.retryDelayMs * 2 ** (attempt - 1));
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      // After a failure, re-sync the offset with the server before sending again.
      const fresh = await this.deps.api.uploadStatus(item.projectId, session.id, signal).catch(() => null);
      if (fresh) {
        if (fresh.status === "complete") return fresh;
        offset = fresh.offset;
      }
    }
  }
}
