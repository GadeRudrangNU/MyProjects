import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, buildUrl, parseResponse } from "@/lib/api/client";

describe("api client", () => {
  it("builds query strings and skips empty values", () => {
    expect(buildUrl("/v1/x", { a: 1, b: "two", c: undefined, d: "" })).toBe("/v1/x?a=1&b=two");
    expect(buildUrl("/v1/x")).toBe("/v1/x");
    expect(buildUrl("/v1/x", { a: undefined })).toBe("/v1/x");
  });

  it("validates successful responses against the schema", async () => {
    const schema = z.object({ n: z.number() });
    expect(await parseResponse(new Response(JSON.stringify({ n: 3 })), schema)).toEqual({ n: 3 });
    await expect(parseResponse(new Response(JSON.stringify({ n: "x" })), schema)).rejects.toThrow();
  });

  it("turns error bodies into ApiError with the code and message from the server", async () => {
    const res = new Response(JSON.stringify({ error: { code: "quota_exceeded", message: "Project storage quota exceeded" } }), { status: 413 });
    await expect(parseResponse(res)).rejects.toMatchObject({ status: 413, code: "quota_exceeded", message: "Project storage quota exceeded" });
    await expect(parseResponse(new Response("<html>", { status: 502 }))).rejects.toBeInstanceOf(ApiError);
  });

  it("returns undefined for 204", async () => {
    expect(await parseResponse(new Response(null, { status: 204 }))).toBeUndefined();
  });
});
