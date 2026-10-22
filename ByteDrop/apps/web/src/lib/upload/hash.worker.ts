/// <reference lib="webworker" />
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const SLICE = 4 * 1024 * 1024;
const aborted = new Set<number>();

type Msg =
  | { id: number; type: "file"; file: Blob }
  | { id: number; type: "chunk"; blob: Blob }
  | { id: number; type: "abort" };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  if (msg.type === "abort") {
    aborted.add(msg.id);
    return;
  }
  try {
    if (msg.type === "chunk") {
      const digest = await crypto.subtle.digest("SHA-256", await msg.blob.arrayBuffer());
      self.postMessage({ id: msg.id, type: "done", hash: bytesToHex(new Uint8Array(digest)) });
      return;
    }
    const h = sha256.create();
    for (let off = 0; off < msg.file.size; off += SLICE) {
      if (aborted.has(msg.id)) {
        aborted.delete(msg.id);
        self.postMessage({ id: msg.id, type: "aborted" });
        return;
      }
      h.update(new Uint8Array(await msg.file.slice(off, off + SLICE).arrayBuffer()));
      self.postMessage({ id: msg.id, type: "progress", fraction: Math.min(1, (off + SLICE) / msg.file.size) });
    }
    self.postMessage({ id: msg.id, type: "done", hash: bytesToHex(h.digest()) });
  } catch (err) {
    self.postMessage({ id: msg.id, type: "error", message: (err as Error).message });
  }
};
