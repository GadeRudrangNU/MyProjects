import { describe, expect, it } from "vitest";
import {
  BUCKET_NAME_RE,
  LATENCY_BOUNDS_MS,
  bucketIndexForLatency,
  buildTransformUrl,
  createBucketSchema,
  createUploadSchema,
  createWebhookSchema,
  emptyHistogram,
  fileKindOf,
  formatBytes,
  listObjectsQuery,
  percentileFromHistogram,
  transformQuery,
} from "../src";

describe("file helpers", () => {
  it("classifies content types", () => {
    expect(fileKindOf("image/png")).toBe("image");
    expect(fileKindOf("VIDEO/mp4")).toBe("video");
    expect(fileKindOf("audio/mpeg")).toBe("audio");
    expect(fileKindOf("application/pdf")).toBe("pdf");
    expect(fileKindOf("text/csv")).toBe("text");
    expect(fileKindOf("application/json")).toBe("text");
    expect(fileKindOf("application/zip")).toBe("other");
  });

  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatBytes(250 * 1024 ** 2)).toBe("250 MB");
  });
});

describe("schemas", () => {
  it("accepts DNS-like bucket names only", () => {
    for (const ok of ["abc", "my-bucket-1", "a1b"]) expect(BUCKET_NAME_RE.test(ok)).toBe(true);
    for (const bad of ["ab", "-abc", "abc-", "ABC", "has space", "a".repeat(64)]) expect(BUCKET_NAME_RE.test(bad)).toBe(false);
    expect(createBucketSchema.parse({ name: "valid-name" }).isPublic).toBe(false);
  });

  it("requires a sha256 and a key for uploads", () => {
    const ok = createUploadSchema.safeParse({ key: "a/b.txt", size: 3, sha256: "a".repeat(64) });
    expect(ok.success && ok.data.contentType).toBe("application/octet-stream");
    expect(createUploadSchema.safeParse({ key: "a", size: 3, sha256: "xyz" }).success).toBe(false);
    expect(createUploadSchema.safeParse({ key: "", size: 3, sha256: "a".repeat(64) }).success).toBe(false);
  });

  it("defaults webhook events to all of them and rejects unknown ones", () => {
    expect(createWebhookSchema.parse({ url: "https://example.com/h" }).events).toHaveLength(3);
    expect(createWebhookSchema.safeParse({ url: "https://example.com/h", events: ["nope"] }).success).toBe(false);
    expect(createWebhookSchema.safeParse({ url: "not a url" }).success).toBe(false);
  });

  it("coerces and bounds list queries", () => {
    expect(listObjectsQuery.parse({ limit: "25" }).limit).toBe(25);
    expect(listObjectsQuery.parse({}).sort).toBe("name");
    expect(listObjectsQuery.safeParse({ limit: 1000 }).success).toBe(false);
  });
});

describe("transform URLs", () => {
  it("only emits parameters that differ from the defaults", () => {
    expect(buildTransformUrl("/f/b/k.png", {})).toBe("/f/b/k.png");
    expect(buildTransformUrl("/f/b/k.png", { w: 300, q: 80, format: "webp" })).toBe("/f/b/k.png?w=300&format=webp");
    expect(buildTransformUrl("/f/b/k.png?download=1", { w: 10, q: 50, fit: "cover", h: 5 })).toBe("/f/b/k.png?download=1&w=10&h=5&q=50&fit=cover");
  });

  it("round-trips through the query schema used by the server", () => {
    const url = new URL(buildTransformUrl("http://x/f/b/k.png", { w: 640, q: 70, format: "avif" }));
    const parsed = transformQuery.parse(Object.fromEntries(url.searchParams));
    expect(parsed).toMatchObject({ w: 640, q: 70, format: "avif", fit: "inside" });
    expect(transformQuery.safeParse({ w: 99999 }).success).toBe(false);
  });
});

describe("latency histograms", () => {
  it("assigns samples to the first bound they fit under", () => {
    expect(bucketIndexForLatency(LATENCY_BOUNDS_MS[0])).toBe(0);
    expect(bucketIndexForLatency(LATENCY_BOUNDS_MS[0] + 1)).toBe(1);
    expect(bucketIndexForLatency(10_000_000)).toBe(LATENCY_BOUNDS_MS.length);
  });

  it("interpolates percentiles within a bucket", () => {
    expect(percentileFromHistogram(emptyHistogram(), 0.95)).toBe(0);
    const h = emptyHistogram();
    h[3] = 50;
    h[4] = 50;
    expect(percentileFromHistogram(h, 0.95)).toBe(95);
    expect(percentileFromHistogram(h, 0.5)).toBe(50);
  });
});
