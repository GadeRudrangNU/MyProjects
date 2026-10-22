"use client";

import { useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api/client";

export function RefreshSummaries({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const refresh = useMutation({
    mutationFn: () => api.refreshAnalytics(projectId),
    onSuccess: () => {
      toast("Summaries refreshed");
      router.refresh();
    },
    onError: () => toast("Could not refresh summaries", "error"),
  });
  return (
    <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
      <RefreshCw className={refresh.isPending ? "animate-spin" : ""} /> Refresh now
    </Button>
  );
}
