"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { DEMO } from "@/lib/config";

const schema = z.object({
  name: z.string().trim().min(1, "Enter your name").optional(),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters"),
});
type Values = z.infer<typeof schema>;

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(mode === "signup" ? schema.required({ name: true }) : schema),
    defaultValues: DEMO && mode === "login" ? { email: "demo@bytedrop.dev", password: "demo-password" } : undefined,
  });

  async function onSubmit(values: Values) {
    setError(null);
    const res = await fetch(mode === "signup" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mode === "signup" ? values : { email: values.email, password: values.password }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => null)) as { message?: string } | null) : null;
      setError(body?.message ?? (res ? "Those details did not work. Check them and try again." : "Could not reach the server."));
      return;
    }
    router.push("/projects");
    router.refresh();
  }

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="text-sm font-semibold text-primary">ByteDrop</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "login" ? "Manage buckets, files and delivery analytics." : "Free to start. No card needed."}
        </p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {mode === "signup" ? (
          <Field label="Name" htmlFor="name" error={errors.name?.message}>
            <Input id="name" autoComplete="name" {...register("name")} />
          </Field>
        ) : null}
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} {...register("password")} />
        </Field>
        {error ? (
          <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link className="font-medium text-primary underline" href="/signup">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link className="font-medium text-primary underline" href="/login">
              Sign in
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
