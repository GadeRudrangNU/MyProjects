"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Plus, RotateCw, Trash2, Webhook } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { WEBHOOK_EVENTS, createWebhookSchema, type WebhookDelivery, type WebhookEndpoint } from "@bytedrop/shared";
import { useUrlState } from "@/components/files/use-url-state";
import { SecretDialog } from "@/components/secret-dialog";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api/client";
import { DEMO } from "@/lib/config";
import { formatDateTime } from "@/lib/utils";

interface Page {
  items: WebhookDelivery[];
  nextCursor: string | null;
}

type Input = z.input<typeof createWebhookSchema>;
type Values = z.output<typeof createWebhookSchema>;

const tone = { success: "success", failed: "danger", pending: "warning" } as const;

export function WebhooksPanel({
  projectId,
  endpoints: initialEndpoints,
  initialDeliveries,
  status: initialStatus,
}: {
  projectId: string;
  endpoints: WebhookEndpoint[];
  initialDeliveries: Page;
  status?: string;
}) {
  const url = useUrlState("client");
  const [endpoints, setEndpoints] = useState(initialEndpoints);
  const [status, setStatus] = useState(initialStatus);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [rows, setRows] = useState(initialDeliveries.items);
  const [cursor, setCursor] = useState(initialDeliveries.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [removing, setRemoving] = useState<WebhookEndpoint | null>(null);

  const reloadEndpoints = useCallback(() => void api.webhooks(projectId).then(setEndpoints), [projectId]);
  const reloadDeliveries = useCallback(
    () =>
      void api.deliveries(projectId, { limit: 25, status }).then((p) => {
        setRows(p.items);
        setCursor(p.nextCursor);
      }),
    [projectId, status],
  );

  // The server rendered the first page; the status filter and live updates are fetched from here.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reloadDeliveries();
  }, [status, reloadDeliveries]);

  // Pending deliveries move on their own; poll the log while any are waiting.
  const anyPending = rows.some((r) => r.status === "pending");
  useEffect(() => {
    if (!anyPending || DEMO) return;
    const t = setInterval(reloadDeliveries, 3000);
    return () => clearInterval(t);
  }, [anyPending, reloadDeliveries]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Input, unknown, Values>({
    resolver: zodResolver(createWebhookSchema),
    defaultValues: { url: "", events: [...WEBHOOK_EVENTS] },
  });

  const create = useMutation({
    mutationFn: (v: Values) => api.createWebhook(projectId, v),
    onSuccess: (w) => {
      setOpen(false);
      reset();
      setSecret(w.secret);
      reloadEndpoints();
    },
  });
  const remove = useMutation({
    mutationFn: (w: WebhookEndpoint) => api.deleteWebhook(projectId, w.id),
    onSuccess: () => {
      toast("Endpoint removed");
      setRemoving(null);
      reloadEndpoints();
    },
    onError: () => toast("Could not remove the endpoint", "error"),
  });
  const replay = useMutation({
    mutationFn: (d: WebhookDelivery) => api.replay(projectId, d.id),
    onSuccess: (d) => {
      setRows((cur) => cur.map((r) => (r.id === d.id ? d : r)));
      toast("Delivery queued again");
      setTimeout(reloadDeliveries, 1200);
    },
    onError: () => toast("Could not replay that delivery", "error"),
  });

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const next = await api.deliveries(projectId, { cursor, limit: 25, status });
      setRows((cur) => [...cur, ...next.items]);
      setCursor(next.nextCursor);
    } catch {
      toast("Could not load more deliveries", "error");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="endpoints-h" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="endpoints-h" className="text-base font-semibold">
            Endpoints
          </h2>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus /> Add endpoint
              </Button>
            </DialogTrigger>
            <DialogContent title="Add webhook endpoint" description="We send a signed POST for each event you select.">
              <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4" noValidate>
                <Field label="Endpoint URL" htmlFor="wh-url" error={errors.url?.message ?? (create.error as Error | null)?.message}>
                  <Input id="wh-url" type="url" autoFocus placeholder="https://example.com/hooks/bytedrop" {...register("url")} />
                </Field>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Events</legend>
                  {WEBHOOK_EVENTS.map((ev) => (
                    <label key={ev} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" value={ev} className="size-4 accent-[var(--primary)]" {...register("events")} />
                      <code className="text-xs">{ev}</code>
                    </label>
                  ))}
                  {errors.events ? (
                    <p role="alert" className="text-xs font-medium text-danger">
                      Pick at least one event
                    </p>
                  ) : null}
                </fieldset>
                <Button type="submit" disabled={create.isPending}>
                  Add endpoint
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        {endpoints.length === 0 ? (
          <EmptyState icon={<Webhook />} title="No endpoints yet">
            Add an endpoint to be told when files are created, deleted or fail to upload.
          </EmptyState>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {endpoints.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={w.url}>
                    {w.url}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {w.events.map((e) => (
                      <Badge key={e}>{e}</Badge>
                    ))}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setRemoving(w)} aria-label={`Remove ${w.url}`}>
                  <Trash2 /> Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="deliveries-h" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="deliveries-h" className="text-base font-semibold">
            Delivery log
          </h2>
          <div className="w-40">
            <label htmlFor="delivery-status" className="mb-1 block text-xs font-medium text-muted-foreground">
              Status
            </label>
            <Select id="delivery-status" value={status ?? ""} onChange={(e) => {
                const v = e.target.value || undefined;
                url.set({ status: v });
                setStatus(v);
              }}>
              <option value="">All</option>
              <option value="success">Succeeded</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </Select>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No deliveries" icon={<Webhook />}>
            {status ? "Nothing matches this status." : "Deliveries appear here as soon as an event is sent."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">Webhook deliveries</caption>
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Event</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Attempts</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Response</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Sent (UTC)</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-t" data-testid="delivery-row" data-status={d.status}>
                    <td className="px-4 py-2.5">
                      <code className="text-xs">{d.eventType}</code>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={tone[d.status]}>{d.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{d.attempts}</td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">
                      {d.lastStatusCode ? `${d.lastStatusCode} · ${d.lastResponseMs} ms` : d.lastError ?? "—"}
                    </td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{formatDateTime(d.createdAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {d.status === "failed" ? (
                        <Button variant="outline" size="sm" disabled={replay.isPending} onClick={() => replay.mutate(d)} aria-label={`Replay ${d.eventType} delivery`}>
                          <RotateCw /> Replay
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cursor ? (
              <div className="border-t p-3 text-center">
                <Button variant="ghost" size="sm" onClick={more} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <SecretDialog title="Signing secret" secret={secret} onClose={() => setSecret(null)} />

      <Dialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)}>
        {removing ? (
          <DialogContent title="Remove this endpoint?" description={removing.url}>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(removing)}>
                Remove endpoint
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
