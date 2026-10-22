import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Hasher } from "./types";

type WorkerReply =
  | { id: number; type: "progress"; fraction: number }
  | { id: number; type: "done"; hash: string }
  | { id: number; type: "aborted" }
  | { id: number; type: "error"; message: string };

/** Hashes in a Web Worker so large files never block the main thread. */
export class WorkerHasher implements Hasher {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (h: string) => void; reject: (e: Error) => void; progress?: (f: number) => void }>();

  private ensure() {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === "progress") p.progress?.(m.fraction);
      else {
        this.pending.delete(m.id);
        if (m.type === "done") p.resolve(m.hash);
        else if (m.type === "aborted") p.reject(new DOMException("aborted", "AbortError"));
        else p.reject(new Error(m.message));
      }
    };
    this.worker = w;
    return w;
  }

  hashFile(file: Blob, onProgress: (f: number) => void, signal: AbortSignal) {
    const w = this.ensure();
    const id = ++this.seq;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress: onProgress });
      signal.addEventListener("abort", () => w.postMessage({ id, type: "abort" }), { once: true });
      w.postMessage({ id, type: "file", file });
    });
  }

  hashChunk(chunk: Blob) {
    const w = this.ensure();
    const id = ++this.seq;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ id, type: "chunk", blob: chunk });
    });
  }
}

/** Same interface without a worker: used by unit tests and environments without Worker support. */
export class MainThreadHasher implements Hasher {
  async hashFile(file: Blob, onProgress: (f: number) => void, signal: AbortSignal) {
    const h = sha256.create();
    const SLICE = 1024 * 1024;
    for (let off = 0; off < file.size; off += SLICE) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      h.update(new Uint8Array(await file.slice(off, off + SLICE).arrayBuffer()));
      onProgress(Math.min(1, (off + SLICE) / file.size));
    }
    return bytesToHex(h.digest());
  }
  async hashChunk(chunk: Blob) {
    return bytesToHex(sha256(new Uint8Array(await chunk.arrayBuffer())));
  }
}
