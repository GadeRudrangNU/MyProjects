import { describe, expect, it } from "vitest";
import { demoAnalytics } from "@/lib/demo/analytics";
import { DEMO_PROJECT_ID } from "@/lib/demo/data";
import { handleDemo } from "@/lib/demo/router";

const base = `/v1/projects/${DEMO_PROJECT_ID}`;
const get = (path: string) => handleDemo("GET", `${base}${path}`);

describe("demo API", () => {
  it("pages through a large bucket with cursors and no duplicates", () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = get(`/buckets/acme-archive/objects?limit=200${cursor ? `&cursor=${cursor}` : ""}`);
      const body = res.body as { items: { key: string }[]; nextCursor: string | null };
      body.items.forEach((i) => seen.add(i.key));
      cursor = body.nextCursor;
      pages++;
    } while (cursor);
    expect(seen.size).toBe(12_000);
    expect(pages).toBe(60);
  });

  it("sorts, filters and searches", () => {
    const bySize = (get("/buckets/acme-assets/objects?sort=size&dir=desc").body as { items: { size: number }[] }).items;
    expect(bySize.map((i) => i.size)).toEqual([...bySize.map((i) => i.size)].sort((a, b) => b - a));
    const images = (get("/buckets/acme-assets/objects?kind=image").body as { items: { kind: string }[] }).items;
    expect(images.length).toBeGreaterThan(5);
    expect(images.every((i) => i.kind === "image")).toBe(true);
    expect((get("/buckets/acme-assets/objects?q=HANDBOOK").body as { items: unknown[] }).items).toHaveLength(1);
  });

  it("validates bucket names and rejects duplicates", () => {
    expect(handleDemo("POST", `${base}/buckets`, { name: "Bad Name" }).status).toBe(400);
    expect(handleDemo("POST", `${base}/buckets`, { name: "acme-assets" }).status).toBe(409);
    expect(handleDemo("POST", `${base}/buckets`, { name: "fresh-bucket", isPublic: true }).status).toBe(201);
    expect(handleDemo("DELETE", `${base}/buckets/fresh-bucket`).status).toBe(204);
  });

  it("shows a key secret only on creation", () => {
    const created = handleDemo("POST", `${base}/keys`, { name: "k", scope: "write" }).body as { secret: string; id: string };
    expect(created.secret).toMatch(/^bd_live_/);
    expect(JSON.stringify(get("/keys").body)).not.toContain(created.secret);
    expect(handleDemo("DELETE", `${base}/keys/${created.id}`).status).toBe(200);
  });

  it("replays a failed delivery", () => {
    const failed = (get("/webhooks/deliveries?status=failed").body as { items: { id: string }[] }).items[0]!;
    const res = handleDemo("POST", `${base}/webhooks/deliveries/${failed.id}/replay`);
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("pending");
  });

  it("returns 404 for unknown routes and projects", () => {
    expect(handleDemo("GET", "/v1/projects/00000000-0000-4000-8000-000000000999").status).toBe(404);
    expect(handleDemo("GET", "/v1/nope").status).toBe(404);
  });
});

describe("demo analytics", () => {
  const now = Date.UTC(2026, 9, 15, 12);
  const day = { from: new Date(now - 86_400_000).toISOString(), to: new Date(now).toISOString() };

  it("is deterministic and internally consistent", () => {
    const a = demoAnalytics(day, now);
    expect(a).toEqual(demoAnalytics(day, now));
    expect(a.series.reduce((s, p) => s + p.requests, 0)).toBe(a.totals.requests);
    expect(a.totals.cacheHitRate).toBeGreaterThan(0.85);
  });

  it("filters by file type and switches to daily points for long ranges", () => {
    const only = demoAnalytics({ ...day, kind: "pdf" }, now);
    expect(only.topFiles.every((f) => f.key.endsWith(".pdf"))).toBe(true);
    const long = demoAnalytics({ from: new Date(now - 14 * 86_400_000).toISOString(), to: day.to }, now);
    expect(long.series.length).toBeLessThanOrEqual(16);
  });
});
