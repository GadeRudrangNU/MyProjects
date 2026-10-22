"use client";

import { useMutation } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { StoredObject } from "@bytedrop/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Input, Label } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api/client";
import { encodeKeyPath, formatDateTime } from "@/lib/utils";

export const EXPIRY_OPTIONS = [
  { label: "5 minutes", seconds: 300 },
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
  { label: "30 days", seconds: 2_592_000 },
];

export function ShareDialog({
  projectId,
  bucket,
  isPublic,
  item,
  onClose,
}: {
  projectId: string;
  bucket: string;
  isPublic: boolean;
  item: StoredObject | null;
  onClose: () => void;
}) {
  const [seconds, setSeconds] = useState(3600);
  const sign = useMutation({
    mutationFn: () => api.sign(projectId, bucket, { key: item!.key, expiresInSeconds: seconds }),
  });
  useEffect(() => sign.reset(), [item]); // eslint-disable-line react-hooks/exhaustive-deps

  const publicUrl = item && typeof window !== "undefined" ? `${window.location.origin}/f/${bucket}/${encodeKeyPath(item.key)}` : "";
  const link = isPublic ? publicUrl : sign.data ? new URL(sign.data.url, window.location.origin).href : "";

  return (
    <Dialog open={Boolean(item)} onOpenChange={(o) => !o && onClose()}>
      {item ? (
        <DialogContent
          title="Share link"
          description={
            isPublic
              ? "This bucket is public, so the link works for anyone and does not expire."
              : "Private files need a signed link. Pick how long it should work."
          }
        >
          <div className="space-y-4">
            <p className="truncate text-sm font-medium" title={item.key}>
              {item.key}
            </p>
            {isPublic ? null : (
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="expiry">Link expires after</Label>
                  <Select id="expiry" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                    {EXPIRY_OPTIONS.map((o) => (
                      <option key={o.seconds} value={o.seconds}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button onClick={() => sign.mutate()} disabled={sign.isPending}>
                  <Link2 /> {sign.data ? "New link" : "Create link"}
                </Button>
              </div>
            )}
            {sign.error ? (
              <p role="alert" className="text-sm text-danger">
                {(sign.error as Error).message}
              </p>
            ) : null}
            {link ? (
              <div className="space-y-2">
                <Label htmlFor="share-url">Link</Label>
                <div className="flex gap-2">
                  <Input id="share-url" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                  <CopyButton value={link} label="Copy link" />
                </div>
                {sign.data ? <p className="text-xs text-muted-foreground">Expires {formatDateTime(sign.data.expiresAt)} UTC</p> : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
