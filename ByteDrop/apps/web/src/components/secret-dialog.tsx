"use client";

import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/form";

/** Shows a freshly issued secret exactly once; closing the dialog discards it from the page. */
export function SecretDialog({
  title,
  secret,
  onClose,
}: {
  title: string;
  secret: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(secret)} onOpenChange={(o) => !o && onClose()}>
      {secret ? (
        <DialogContent title={title} description="Copy it now. For your security it will not be shown again.">
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md bg-warning-bg p-3 text-sm text-warning">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <p>Store this secret somewhere safe. If you lose it, create a new one.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="secret-value">Secret</Label>
              <div className="flex gap-2">
                <Input id="secret-value" readOnly value={secret} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <CopyButton value={secret} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose}>I have saved it</Button>
            </div>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
