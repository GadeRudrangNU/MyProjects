"use client";

import { useEffect, useState } from "react";
import { DEMO } from "../config";

declare global {
  interface Window {
    __mswReady?: Promise<unknown>;
    __startMsw?: () => void;
  }
}

/**
 * Demo mode answers API calls with a service worker, but it is only started when something actually needs it so the
 * first paint of every page stays light. Resolves once requests are being intercepted.
 */
export async function waitForDemoBackend() {
  for (let i = 0; i < 500 && !window.__mswReady; i++) {
    window.__startMsw?.();
    await new Promise((r) => setTimeout(r, 20));
  }
  await window.__mswReady;
}

/** True once files and images can be requested (always true outside demo mode). */
export function useBackendReady(enabled = true) {
  const [ready, setReady] = useState(!DEMO);
  useEffect(() => {
    if (DEMO && enabled) void waitForDemoBackend().then(() => setReady(true));
  }, [enabled]);
  return ready;
}
