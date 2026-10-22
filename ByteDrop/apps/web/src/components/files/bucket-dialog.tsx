"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createBucketSchema, type Bucket } from "@bytedrop/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { api } from "@/lib/api/client";

type Input = z.input<typeof createBucketSchema>;
type Values = z.output<typeof createBucketSchema>;

export function BucketDialog({ projectId, onCreated }: { projectId: string; onCreated: (bucket: Bucket) => void }) {
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Input, unknown, Values>({ resolver: zodResolver(createBucketSchema), defaultValues: { name: "", isPublic: false } });
  const create = useMutation({
    mutationFn: (v: Values) => api.createBucket(projectId, v),
    onSuccess: (b) => {
      setOpen(false);
      reset();
      onCreated(b);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FolderPlus /> New bucket
        </Button>
      </DialogTrigger>
      <DialogContent title="New bucket" description="Bucket names are unique across ByteDrop and appear in delivery URLs.">
        <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4" noValidate>
          <Field
            label="Bucket name"
            htmlFor="bucket-name"
            hint="Lowercase letters, digits and hyphens, 3-63 characters."
            error={errors.name?.message ?? (create.error as Error | null)?.message}
          >
            <Input id="bucket-name" autoFocus autoComplete="off" {...register("name")} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...register("isPublic")} />
            <span>
              <span className="font-medium">Public bucket</span>
              <span className="block text-xs text-muted-foreground">Anyone with the URL can download files. Leave off to require signed links.</span>
            </span>
          </label>
          <Button type="submit" disabled={create.isPending}>
            Create bucket
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
