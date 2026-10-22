"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { createProjectSchema } from "@bytedrop/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { api } from "@/lib/api/client";
import { DEMO } from "@/lib/config";

type Values = { name: string };

export function CreateProject() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(createProjectSchema) });
  const create = useMutation({
    mutationFn: (v: Values) => api.createProject(v.name),
    onSuccess: (p) => {
      setOpen(false);
      reset();
      router.push(`/p/${p.id}/files`);
      router.refresh();
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={DEMO} title={DEMO ? "Creating projects is disabled in the demo" : undefined}>
          <Plus /> New project
        </Button>
      </DialogTrigger>
      <DialogContent title="New project" description="Projects hold buckets, API keys and webhooks.">
        <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4" noValidate>
          <Field label="Project name" htmlFor="project-name" error={errors.name?.message ?? (create.error as Error | null)?.message}>
            <Input id="project-name" autoFocus {...register("name")} />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            Create project
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
