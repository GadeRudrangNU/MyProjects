// @vitest-environment node
import { UPLOAD_CHUNK_SIZE } from "@bytedrop/shared";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "@/lib/api/endpoints";
import { clientRequest } from "@/lib/api/client";
import { DEMO_PROJECT_ID, demoState } from "@/lib/demo/data";
import { idbStore, memoryStore } from "@/lib/upload/idb-store";
import { MainThreadHasher } from "@/lib/upload/hashers";
import { UploadManager } from "@/lib/upload/manager";
import type { UploadItem } from "@/lib/upload/types";
import { server } from "./setup";

const api = createApi(clientRequest);
const absolute: typeof fetch = (input, init) => fetch(typeof input === "string" ? `http://demo.local${input}` : input, init);

function file(size: number, name = "data.bin") {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 4096) bytes[i] = (i / 4096) % 251;
  return new File([bytes], name, { type: "application/octet-stream" });
}

function make(overrides: Partial<ConstructorParameters<typeof UploadManager>[0]> = {}) {
  const onComplete = vi.fn();
  const store = overrides.store ?? memoryStore();
  const manager = new UploadManager({
    api,
    hasher: new MainThreadHasher(),
    store,
    fetchImpl: absolute,
    retryDelayMs: 1,
    onComplete,
    ...overrides,
  });
  return { manager, onComplete, store };
}

const target = { projectId: DEMO_PROJECT_ID, bucket: "acme-assets" };
const status = (m: UploadManager, i = 0) => m.getSnapshot()[i]?.status;
const settle = async (m: UploadManager, want: string, i = 0) =>
  vi.waitFor(() => expect(status(m, i), m.getSnapshot()[i]?.error).toBe(want), { timeout: 10_000, interval: 10 });

describe("UploadManager", () => {
  it("hashes, uploads in chunks and reports completion", async () => {
    const { manager, onComplete } = make();
    manager.add([file(UPLOAD_CHUNK_SIZE * 2 + 500, "three-chunks.bin")], target);
    await settle(manager, "done");
    const item = manager.getSnapshot()[0]!;
    expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(item.sent).toBe(UPLOAD_CHUNK_SIZE * 2 + 500);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(demoState().objects["acme-assets"]!.some((o) => o.key === "three-chunks.bin")).toBe(true);
  });

  it("completes an empty file without sending chunks", async () => {
    const patches = vi.fn();
    server.use(http.patch("*/v1/projects/*/uploads/*", () => (patches(), HttpResponse.json({}))));
    const { manager } = make();
    manager.add([file(0, "empty.txt")], target);
    await settle(manager, "done");
    expect(patches).not.toHaveBeenCalled();
  });

  it("pauses between chunks and continues from the server's offset on resume", async () => {
    const offsets: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const slow: typeof fetch = async (input, init) => {
      offsets.push(Number((init?.headers as Record<string, string>)["upload-offset"]));
      if (first) {
        first = false;
        await gate;
      }
      return absolute(input, init);
    };
    const { manager } = make({ fetchImpl: slow });
    manager.add([file(UPLOAD_CHUNK_SIZE * 3, "pausable.bin")], target);
    await vi.waitFor(() => expect(offsets.length).toBe(1));
    manager.pause(manager.getSnapshot()[0]!.id);
    expect(status(manager)).toBe("paused");
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(status(manager)).toBe("paused");

    manager.resume(manager.getSnapshot()[0]!.id);
    await settle(manager, "done");
    // The first chunk was never confirmed, so the resumed upload starts again from offset 0 and then advances.
    expect(offsets.slice(1)).toEqual([0, UPLOAD_CHUNK_SIZE, UPLOAD_CHUNK_SIZE * 2]);
  });

  it("restores a queue after a refresh and resumes from what the server already holds", async () => {
    const store = memoryStore();
    const data = file(UPLOAD_CHUNK_SIZE * 3, "survivor.bin");
    const hasher = new MainThreadHasher();
    const sha = await hasher.hashFile(data, () => {}, new AbortController().signal);

    // Simulate a previous page load that got one chunk in before the tab closed.
    const session = await api.createUpload(DEMO_PROJECT_ID, "acme-assets", { key: "survivor.bin", size: data.size, sha256: sha, contentType: data.type });
    await absolute(`/v1/projects/${DEMO_PROJECT_ID}/uploads/${session.id}`, {
      method: "PATCH",
      headers: { "upload-offset": "0", "x-chunk-sha256": "x", "content-type": "application/octet-stream" },
      body: data.slice(0, UPLOAD_CHUNK_SIZE),
    });
    const saved: UploadItem = {
      id: "restored-1",
      projectId: DEMO_PROJECT_ID,
      bucket: "acme-assets",
      key: "survivor.bin",
      name: "survivor.bin",
      size: data.size,
      type: data.type,
      status: "uploading",
      hashProgress: 1,
      sent: UPLOAD_CHUNK_SIZE,
      sha256: sha,
      sessionId: session.id,
      createdAt: Date.now(),
    };
    await store.save(saved, data);

    const offsets: number[] = [];
    const spy: typeof fetch = (input, init) => {
      offsets.push(Number((init?.headers as Record<string, string>)["upload-offset"]));
      return absolute(input, init);
    };
    const { manager } = make({ store, fetchImpl: spy });
    await manager.restore();
    expect(manager.getSnapshot()).toHaveLength(1);
    await settle(manager, "done");
    expect(offsets).toEqual([UPLOAD_CHUNK_SIZE, UPLOAD_CHUNK_SIZE * 2]);
  });

  it("shows an error, then retries successfully", async () => {
    let fail = true;
    const flaky: typeof fetch = (input, init) =>
      fail
        ? Promise.resolve(new Response(JSON.stringify({ error: { code: "chunk_too_large", message: "nope" } }), { status: 400 }))
        : absolute(input, init);
    const { manager } = make({ fetchImpl: flaky });
    manager.add([file(UPLOAD_CHUNK_SIZE + 10, "flaky.bin")], target);
    await settle(manager, "error");
    expect(manager.getSnapshot()[0]!.error).toBe("nope");
    fail = false;
    manager.retry(manager.getSnapshot()[0]!.id);
    await settle(manager, "done");
  });

  it("retries transient 5xx responses on its own", async () => {
    let calls = 0;
    const flaky: typeof fetch = (input, init) => {
      calls++;
      return calls <= 2 ? Promise.resolve(new Response("{}", { status: 503 })) : absolute(input, init);
    };
    const { manager } = make({ fetchImpl: flaky });
    manager.add([file(1000, "transient.bin")], target);
    await settle(manager, "done");
    expect(calls).toBe(3);
  });

  it("adopts the server's offset after a 409", async () => {
    let once = true;
    const lost: typeof fetch = async (input, init) => {
      const res = await absolute(input, init);
      if (once) {
        once = false;
        // The chunk landed but the response was lost; replaying it must not corrupt anything.
        return absolute(input, init);
      }
      return res;
    };
    const { manager } = make({ fetchImpl: lost });
    manager.add([file(UPLOAD_CHUNK_SIZE * 2, "replayed.bin")], target);
    await settle(manager, "done");
  });

  it("cancels an upload and tells the server", async () => {
    const cancelled = vi.fn();
    server.use(http.delete("*/v1/projects/*/uploads/*", () => (cancelled(), new HttpResponse(null, { status: 204 }))));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { manager } = make({ fetchImpl: async (i, n) => (await gate, absolute(i, n)) });
    manager.add([file(UPLOAD_CHUNK_SIZE * 2, "cancel.bin")], target);
    await vi.waitFor(() => expect(manager.getSnapshot()[0]?.sessionId).toBeTruthy());
    await manager.cancel(manager.getSnapshot()[0]!.id);
    release();
    expect(status(manager)).toBe("cancelled");
    expect(cancelled).toHaveBeenCalled();
  });

  it("runs at most two uploads at a time", async () => {
    let active = 0;
    let peak = 0;
    const counting: typeof fetch = async (input, init) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      try {
        return await absolute(input, init);
      } finally {
        active--;
      }
    };
    const { manager } = make({ fetchImpl: counting });
    manager.add([file(500, "a.bin"), file(600, "b.bin"), file(700, "c.bin"), file(800, "d.bin")], target);
    await vi.waitFor(() => expect(manager.getSnapshot().every((u) => u.status === "done")).toBe(true), { timeout: 10_000 });
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("IndexedDB store", () => {
  it("round-trips the queue entry together with the file", async () => {
    const item: UploadItem = {
      id: "x1",
      projectId: "p",
      bucket: "b",
      key: "k.txt",
      name: "k.txt",
      size: 5,
      type: "text/plain",
      status: "paused",
      hashProgress: 1,
      sent: 2,
      createdAt: 1,
    };
    await idbStore.save(item, new Blob(["hello"], { type: "text/plain" }));
    const rows = await idbStore.loadAll();
    const row = rows.find((r) => r.item.id === "x1")!;
    expect(row.item).toMatchObject({ key: "k.txt", status: "paused", sent: 2 });
    expect(await row.file.text()).toBe("hello");
    await idbStore.remove("x1");
    expect((await idbStore.loadAll()).find((r) => r.item.id === "x1")).toBeUndefined();
  });
});
