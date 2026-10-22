"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { DEMO } from "@/lib/config";
import { ToastProvider } from "@/components/ui/toast";

// Demo mode serves every API call from seeded in-memory data via a service worker (browser only).
const MswStarter = dynamic(() => import("@/components/msw-starter"), { ssr: false });

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );

  const [mswOn, setMswOn] = useState(false);
  useEffect(() => {
    if (DEMO) window.__startMsw = () => setMswOn(true);
  }, []);

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        {DEMO && mswOn ? <MswStarter /> : null}
        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
}
