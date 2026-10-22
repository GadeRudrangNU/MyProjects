import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { guarded, serverApi } from "@/lib/api/server";
import { DEMO } from "@/lib/config";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await guarded(() => serverApi.me());
  return (
    <div className="flex min-h-dvh flex-col">
      {DEMO ? (
        <aside aria-label="Demo notice" className="bg-accent px-4 py-1.5 text-center text-xs text-accent-foreground">
          <p>Demo mode: sample data, nothing leaves your browser, changes reset when you reload.</p>
        </aside>
      ) : null}
      <header className="flex h-14 items-center justify-between border-b px-4 sm:px-6">
        <Link href="/projects" className="flex items-center gap-2 font-semibold">
          <span aria-hidden className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            B
          </span>
          ByteDrop
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-muted-foreground sm:inline">{me.email}</span>
          {DEMO ? null : <SignOutButton />}
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
