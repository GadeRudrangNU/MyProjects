import { describe, expect, it } from "vitest";
import { resolveRange } from "@/lib/analytics-range";

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);

describe("resolveRange", () => {
  it("defaults to the last 24 hours", () => {
    const r = resolveRange({}, NOW);
    expect(r.preset).toBe("24h");
    expect(new Date(r.to).getTime() - new Date(r.from).getTime()).toBe(86_400_000);
  });

  it("understands presets", () => {
    const r = resolveRange({ range: "30d" }, NOW);
    expect(new Date(r.to).getTime() - new Date(r.from).getTime()).toBe(30 * 86_400_000);
  });

  it("uses a custom day range, inclusive of the last day, and never reaches into the future", () => {
    const r = resolveRange({ from: "2026-10-01", to: "2026-10-03" }, NOW);
    expect(r.preset).toBe("custom");
    expect(r.from).toBe("2026-10-01T00:00:00.000Z");
    expect(r.to).toBe("2026-10-03T23:59:59.999Z");
    expect(resolveRange({ from: "2026-10-10", to: "2026-12-31" }, NOW).to).toBe(new Date(NOW).toISOString());
  });

  it("falls back for garbage, reversed or oversized input", () => {
    expect(resolveRange({ range: "nope" }, NOW).preset).toBe("24h");
    expect(resolveRange({ from: "yesterday" }, NOW).preset).toBe("24h");
    expect(resolveRange({ from: "2026-10-10", to: "2026-10-01" }, NOW).preset).toBe("24h");
    expect(resolveRange({ from: "2025-01-01" }, NOW).preset).toBe("24h");
  });
});
