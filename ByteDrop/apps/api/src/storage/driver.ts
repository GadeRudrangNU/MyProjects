import type { Readable } from "node:stream";

export interface ByteRange {
  start: number;
  end: number;
}

export interface StorageDriver {
  /** Directory-like scratch area for in-flight uploads. */
  tempPath(name: string): string;
  /** Move a finished temp file into content-addressed storage. No-op if the blob already exists. */
  put(tmpFile: string, hash: string): Promise<void>;
  open(hash: string, range?: ByteRange): Readable;
  exists(hash: string): Promise<boolean>;
  remove(hash: string): Promise<void>;
  localPath(hash: string): string;
  checkWritable(): Promise<void>;
}
