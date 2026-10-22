"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createApiKeySchema, type ApiKey } from "@bytedrop/shared";
import { SecretDialog } from "@/components/secret-dialog";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api/client";
import { formatDate, timeAgo } from "@/lib/utils";

type Input = z.input<typeof createApiKeySchema>;
type Values = z.output<typeof createApiKeySchema>;

export function KeysPanel({ projectId, keys: initialKeys }: { projectId: string; keys: ApiKey[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const reload = useCallback(() => void api.keys(projectId).then(setKeys), [projectId]);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Input, unknown, Values>({ resolver: zodResolver(createApiKeySchema), defaultValues: { name: "", scope: "read" } });

  const create = useMutation({
    mutationFn: (v: Values) => api.createKey(projectId, v),
    onSuccess: (k) => {
      setOpen(false);
      reset();
      setSecret(k.secret);
      reload();
    },
  });
  const revoke = useMutation({
    mutationFn: (k: ApiKey) => api.revokeKey(projectId, k.id),
    onSuccess: () => {
      toast("API key revoked");
      setRevoking(null);
      reload();
    },
    onError: () => toast("Could not revoke the key", "error"),
  });

  return (
    <div className="space-y-4">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus /> Create API key
          </Button>
        </DialogTrigger>
        <DialogContent title="Create API key" description="Read keys can list and download. Write keys can also upload and delete.">
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4" noValidate>
            <Field label="Name" htmlFor="key-name" error={errors.name?.message ?? (create.error as Error | null)?.message}>
              <Input id="key-name" autoFocus placeholder="e.g. Website (read)" {...register("name")} />
            </Field>
            <Field label="Permissions" htmlFor="key-scope">
              <Select id="key-scope" {...register("scope")}>
                <option value="read">Read only</option>
                <option value="write">Read and write</option>
              </Select>
            </Field>
            <Button type="submit" disabled={create.isPending}>
              Create key
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {keys.length === 0 ? (
        <EmptyState icon={<KeyRound />} title="No API keys yet">
          Create a key to call the API from your own servers.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">API keys</caption>
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Name</th>
                <th scope="col" className="px-4 py-2 font-medium">Key</th>
                <th scope="col" className="px-4 py-2 font-medium">Access</th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Created</th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Last used</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t">
                  <td className="px-4 py-2.5 font-medium">{k.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{k.prefix}…</td>
                  <td className="px-4 py-2.5">
                    {k.revokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone={k.scope === "write" ? "warning" : "info"}>{k.scope === "write" ? "Read + write" : "Read only"}</Badge>}
                  </td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{formatDate(k.createdAt)}</td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : "Never"}</td>
                  <td className="px-4 py-2.5 text-right">
                    {k.revokedAt ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setRevoking(k)} aria-label={`Revoke ${k.name}`}>
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SecretDialog title="Your new API key" secret={secret} onClose={() => setSecret(null)} />

      <Dialog open={Boolean(revoking)} onOpenChange={(o) => !o && setRevoking(null)}>
        {revoking ? (
          <DialogContent title={`Revoke “${revoking.name}”?`} description="Anything using this key will start receiving 401 errors immediately.">
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRevoking(null)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate(revoking)}>
                Revoke key
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
