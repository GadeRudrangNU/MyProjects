"use client";

import { CheckCircle2, ChevronDown, ChevronUp, Pause, Play, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { formatBytes } from "@bytedrop/shared";
import { Button } from "@/components/ui/button";
import { useUploadManager, useUploads } from "@/lib/upload";
import type { UploadItem } from "@/lib/upload/types";

function progressOf(i: UploadItem) {
  if (i.status === "done") return 1;
  if (i.status === "hashing" || (!i.sha256 && i.status !== "uploading")) return i.hashProgress;
  return i.size === 0 ? 1 : i.sent / i.size;
}

function label(i: UploadItem) {
  switch (i.status) {
    case "queued":
      return "Waiting";
    case "hashing":
      return `Checking file ${Math.round(i.hashProgress * 100)}%`;
    case "uploading":
      return `Uploading ${formatBytes(i.sent)} of ${formatBytes(i.size)}`;
    case "paused":
      return `Paused at ${Math.round((i.size ? i.sent / i.size : 0) * 100)}%`;
    case "done":
      return "Uploaded";
    case "cancelled":
      return "Cancelled";
    case "error":
      return i.error ?? "Failed";
  }
}

export function UploadPanel() {
  const uploads = useUploads();
  const manager = useUploadManager();
  const [collapsed, setCollapsed] = useState(false);
  if (uploads.length === 0) return null;
  const active = uploads.filter((u) => ["queued", "hashing", "uploading"].includes(u.status)).length;
  const finished = uploads.some((u) => u.status === "done" || u.status === "cancelled");

  return (
    <section
      aria-label="Upload queue"
      className="fixed inset-x-3 bottom-3 z-40 rounded-xl border bg-card shadow-xl sm:inset-x-auto sm:right-4 sm:w-96"
    >
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold" aria-live="polite">
          {active > 0 ? `Uploading ${active} file${active === 1 ? "" : "s"}` : "Uploads"}
        </h2>
        <div className="flex items-center gap-1">
          {finished ? (
            <Button variant="ghost" size="sm" onClick={() => manager.clearFinished()}>
              Clear finished
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={collapsed ? "Expand upload queue" : "Collapse upload queue"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
      </header>
      {collapsed ? null : (
        <ul className="max-h-72 divide-y overflow-y-auto">
          {uploads.map((u) => {
            const pct = Math.round(progressOf(u) * 100);
            return (
              <li key={u.id} className="space-y-1.5 px-4 py-2.5" data-testid="upload-item" data-status={u.status}>
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium" title={u.key}>
                    {u.name}
                  </p>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {u.status === "uploading" || u.status === "hashing" || u.status === "queued" ? (
                      <Button variant="ghost" size="icon" className="size-7" aria-label={`Pause ${u.name}`} onClick={() => manager.pause(u.id)}>
                        <Pause />
                      </Button>
                    ) : null}
                    {u.status === "paused" ? (
                      <Button variant="ghost" size="icon" className="size-7" aria-label={`Resume ${u.name}`} onClick={() => manager.resume(u.id)}>
                        <Play />
                      </Button>
                    ) : null}
                    {u.status === "error" ? (
                      <Button variant="ghost" size="icon" className="size-7" aria-label={`Retry ${u.name}`} onClick={() => manager.retry(u.id)}>
                        <RotateCcw />
                      </Button>
                    ) : null}
                    {u.status === "done" ? (
                      <CheckCircle2 aria-label="Uploaded" className="mx-1.5 size-4 text-success" />
                    ) : u.status !== "cancelled" ? (
                      <Button variant="ghost" size="icon" className="size-7" aria-label={`Cancel ${u.name}`} onClick={() => void manager.cancel(u.id)}>
                        <X />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div
                  role="progressbar"
                  aria-label={`Progress for ${u.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className={u.status === "error" ? "h-full bg-destructive" : "h-full bg-primary transition-[width]"}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className={u.status === "error" ? "text-xs text-danger" : "text-xs text-muted-foreground"}>{label(u)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
