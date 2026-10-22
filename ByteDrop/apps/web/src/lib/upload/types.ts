export type UploadStatus = "queued" | "hashing" | "uploading" | "paused" | "done" | "error" | "cancelled";

export interface UploadItem {
  id: string;
  projectId: string;
  bucket: string;
  key: string;
  name: string;
  size: number;
  type: string;
  status: UploadStatus;
  /** 0-1 progress of the whole-file hash. */
  hashProgress: number;
  /** Bytes the server has confirmed. */
  sent: number;
  sha256?: string;
  sessionId?: string;
  error?: string;
  createdAt: number;
}

export interface Hasher {
  hashFile(file: Blob, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<string>;
  hashChunk(chunk: Blob): Promise<string>;
}

export interface UploadStore {
  loadAll(): Promise<{ item: UploadItem; file: Blob }[]>;
  save(item: UploadItem, file: Blob): Promise<void>;
  remove(id: string): Promise<void>;
}
