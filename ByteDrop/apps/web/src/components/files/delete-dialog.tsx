"use client";

import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api/client";

export function DeleteDialog({
  projectId,
  bucket,
  keys,
  onClose,
  onDone,
}: {
  projectId: string;
  bucket: string;
  keys: string[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const del = useMutation({
    mutationFn: async (list: string[]) => {
      let failed = 0;
      for (let i = 0; i < list.length; i += 5) {
        const results = await Promise.allSettled(list.slice(i, i + 5).map((k) => api.deleteObject(projectId, bucket, k)));
        failed += results.filter((r) => r.status === "rejected").length;
      }
      return { failed, total: list.length };
    },
    onSuccess: ({ failed, total }) => {
      toast(failed ? `Deleted ${total - failed} of ${total} files` : `Deleted ${total} file${total === 1 ? "" : "s"}`, failed ? "error" : "success");
      onDone();
    },
  });

  return (
    <Dialog open={Boolean(keys)} onOpenChange={(o) => !o && onClose()}>
      {keys ? (
        <DialogContent
          title={`Delete ${keys.length} file${keys.length === 1 ? "" : "s"}?`}
          description="Content that nothing else references is removed from storage after a short grace period."
        >
          <ul className="mb-4 max-h-40 overflow-y-auto rounded-md bg-muted p-3 text-xs">
            {keys.slice(0, 50).map((k) => (
              <li key={k} className="truncate">
                {k}
              </li>
            ))}
            {keys.length > 50 ? <li>…and {keys.length - 50} more</li> : null}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={del.isPending} onClick={() => del.mutate(keys)}>
              <Trash2 /> {del.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
