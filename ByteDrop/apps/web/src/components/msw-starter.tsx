"use client";

import { useEffect } from "react";

/** Demo mode only: registers the mock service worker so every API call is answered from seeded data. */
export default function MswStarter() {
  useEffect(() => {
    window.__mswReady ??= import("@/lib/demo/msw").then((m) => m.startMsw());
  }, []);
  return null;
}
