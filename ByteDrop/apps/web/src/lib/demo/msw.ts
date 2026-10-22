import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

let started: Promise<unknown> | null = null;

/** Starts the mock service worker once; every browser request to /v1, /f and /api/auth is served from demo data. */
export function startMsw() {
  started ??= setupWorker(...handlers).start({
    onUnhandledFrame: "bypass",
    quiet: true,
    serviceWorker: { url: "/mockServiceWorker.js" },
  });
  return started;
}
