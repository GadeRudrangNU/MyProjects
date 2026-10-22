"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * Filters live in the URL so every view can be shared and bookmarked.
 * `client` mode updates the address bar without asking the server to re-render (the component fetches its own data);
 * `server` mode navigates so a server component can re-read its data with the new parameters.
 */
export function useUrlState(mode: "client" | "server" = "server") {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = useCallback(
    (patch: Record<string, string | undefined>) => {
      // Read the address bar, not a render-time snapshot: two quick changes must not overwrite each other.
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      if (mode === "client") window.history.replaceState(null, "", href);
      else startTransition(() => router.replace(href, { scroll: false }));
    },
    [mode, pathname, router],
  );

  return { set, pending, get: (k: string) => search.get(k) ?? undefined };
}
