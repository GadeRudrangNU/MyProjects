"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes, type StoredObject } from "@bytedrop/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useBackendReady } from "@/lib/demo/ready";
import { encodeKeyPath, formatDateTime } from "@/lib/utils";

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    // Range keeps huge text files cheap: only the first 64 KB are fetched.
    fetch(url, { headers: { range: "bytes=0-65535" } })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("failed"))))
      .then((t) => live && setText(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [url]);
  if (failed) return <p className="text-sm text-danger">Could not load a preview.</p>;
  return (
    <pre className="max-h-[50dvh] overflow-auto rounded-md bg-muted p-3 text-xs" tabIndex={0} aria-label="File contents">
      {text ?? "Loading…"}
    </pre>
  );
}

export function PreviewDialog({
  projectId: _projectId,
  bucket,
  item,
  onClose,
}: {
  projectId: string;
  bucket: string;
  item: StoredObject | null;
  onClose: () => void;
}) {
  const ready = useBackendReady(Boolean(item));
  const base = item && ready ? `/f/${bucket}/${encodeKeyPath(item.key)}` : "";
  return (
    <Dialog open={Boolean(item)} onOpenChange={(o) => !o && onClose()}>
      {item ? (
        <DialogContent className="max-w-3xl" title={item.key.split("/").pop() ?? item.key} description={`${item.contentType} · ${formatBytes(item.size)}`}>
          <div className="space-y-4">
            <div className="grid min-h-40 place-items-center overflow-hidden rounded-lg bg-muted/60">
              {item.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${base}?w=1200&format=webp`} alt={`Preview of ${item.key}`} className="max-h-[50dvh] w-auto max-w-full object-contain" />
              ) : item.kind === "video" ? (
                <video controls preload="metadata" src={base} className="max-h-[50dvh] w-full" aria-label={`Video preview of ${item.key}`} />
              ) : item.kind === "audio" ? (
                <audio controls src={base} aria-label={`Audio preview of ${item.key}`} />
              ) : item.kind === "pdf" ? (
                <iframe title={`PDF preview of ${item.key}`} src={base} className="h-[50dvh] w-full bg-white" />
              ) : item.kind === "text" ? (
                <div className="w-full p-2">
                  <TextPreview url={base} />
                </div>
              ) : (
                <p className="p-6 text-sm text-muted-foreground">No preview for this file type.</p>
              )}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Size</dt>
              <dd>{formatBytes(item.size)}</dd>
              <dt className="text-muted-foreground">Type</dt>
              <dd>{item.contentType}</dd>
              <dt className="text-muted-foreground">Uploaded</dt>
              <dd>{formatDateTime(item.createdAt)} UTC</dd>
              <dt className="text-muted-foreground">SHA-256</dt>
              <dd className="break-all font-mono">{item.sha256}</dd>
            </dl>
            <Button asChild variant="outline">
              <a href={`${base}?download=1`} download>
                <Download /> Download
              </a>
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
