"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { api } from "../api/client";
import { idbStore, memoryStore } from "./idb-store";
import { MainThreadHasher, WorkerHasher } from "./hashers";
import { UploadManager } from "./manager";
import type { UploadItem } from "./types";

const Ctx = createContext<UploadManager | null>(null);

function createManager(qc: QueryClient) {
  const hasher = typeof Worker !== "undefined" ? new WorkerHasher() : new MainThreadHasher();
  return new UploadManager({
    api,
    hasher,
    store: typeof indexedDB !== "undefined" ? idbStore : memoryStore(),
    onComplete: (item) => {
      void qc.invalidateQueries({ queryKey: ["objects", item.projectId, item.bucket] });
      void qc.invalidateQueries({ queryKey: ["buckets", item.projectId] });
      void qc.invalidateQueries({ queryKey: ["project", item.projectId] });
    },
  });
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const manager = useMemo(() => createManager(qc), [qc]);
  useEffect(() => {
    void manager.restore();
  }, [manager]);
  return <Ctx.Provider value={manager}>{children}</Ctx.Provider>;
}

export function useUploadManager() {
  const m = useContext(Ctx);
  if (!m) throw new Error("UploadProvider is missing");
  return m;
}

const EMPTY: UploadItem[] = [];
export function useUploads(): UploadItem[] {
  const m = useUploadManager();
  return useSyncExternalStore(m.subscribe, m.getSnapshot, () => EMPTY);
}
