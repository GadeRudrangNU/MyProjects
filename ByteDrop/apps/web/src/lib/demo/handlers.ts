import { http, HttpResponse } from "msw";
import { demoAsset } from "./assets";
import { handleDemo } from "./router";

/** Request handlers shared by the browser service worker (demo mode) and the Node test server. */
export const handlers = [
  http.all("*/v1/*", async ({ request }) => {
    const url = new URL(request.url);
    let body: unknown;
    let chunkBytes: number | undefined;
    if (request.method === "PATCH") {
      chunkBytes = (await request.arrayBuffer()).byteLength;
      body = { offset: Number(request.headers.get("upload-offset") ?? 0) };
    } else if (request.method !== "GET" && request.method !== "DELETE") {
      body = await request.json().catch(() => undefined);
    }
    const res = handleDemo(request.method, url.pathname + url.search, body, chunkBytes);
    if (res.status === 204) return new HttpResponse(null, { status: 204 });
    return HttpResponse.json(res.body as never, { status: res.status, headers: res.headers });
  }),

  http.all("*/api/auth/*", () => HttpResponse.json({ ok: true })),

  http.get("*/f/:bucket/*", ({ request, params }) => {
    const url = new URL(request.url);
    const bucket = String(params.bucket);
    const key = decodeURIComponent(url.pathname.replace(new RegExp(`^/f/${bucket}/`), ""));
    const a = demoAsset(bucket, key, url.searchParams);
    return new HttpResponse(a.body, {
      status: a.status,
      headers: { "content-type": a.contentType, "cache-control": "no-store", etag: `"demo-${key.length}-${url.search.length}"` },
    });
  }),
];
