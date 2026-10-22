import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import { resetDemoState } from "@/lib/demo/data";
import { handlers } from "@/lib/demo/handlers";

if (typeof window !== "undefined") {
  // jsdom lacks a few browser APIs that Radix primitives touch.
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
}

export const server = setupServer(...handlers);

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
  // Relative API URLs resolve against a fixed origin so the mock server can answer them.
  const intercepted = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    intercepted(typeof input === "string" && input.startsWith("/") ? `http://demo.local${input}` : input, init)) as typeof fetch;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetDemoState();
});
afterAll(() => server.close());
