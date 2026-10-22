import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { access, mkdir, rename, rm, stat, writeFile, constants } from "node:fs/promises";
import path from "node:path";
import type { ByteRange, StorageDriver } from "./driver";

export class LocalStorageDriver implements StorageDriver {
  private readonly blobDir: string;
  private readonly tmpDir: string;

  constructor(root: string) {
    this.blobDir = path.join(root, "blobs");
    this.tmpDir = path.join(root, "tmp");
    mkdirSync(this.blobDir, { recursive: true });
    mkdirSync(this.tmpDir, { recursive: true });
  }

  tempPath(name: string) {
    return path.join(this.tmpDir, name);
  }

  localPath(hash: string) {
    return path.join(this.blobDir, hash.slice(0, 2), hash.slice(2, 4), hash);
  }

  async put(tmpFile: string, hash: string) {
    const dest = this.localPath(hash);
    if (existsSync(dest)) {
      await rm(tmpFile, { force: true });
      return;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    try {
      await rename(tmpFile, dest);
    } catch (err) {
      // Another writer won the race on Windows; the content is identical either way.
      if (!existsSync(dest)) throw err;
      await rm(tmpFile, { force: true });
    }
  }

  open(hash: string, range?: ByteRange) {
    return createReadStream(this.localPath(hash), range ? { start: range.start, end: range.end } : undefined);
  }

  async exists(hash: string) {
    try {
      await stat(this.localPath(hash));
      return true;
    } catch {
      return false;
    }
  }

  async remove(hash: string) {
    await rm(this.localPath(hash), { force: true });
  }

  async checkWritable() {
    const probe = path.join(this.tmpDir, ".ready");
    await writeFile(probe, String(Date.now()));
    await access(probe, constants.R_OK | constants.W_OK);
  }
}
