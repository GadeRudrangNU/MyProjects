import { fileKindOf, type StoredObject, type UploadSession } from "@bytedrop/shared";
import { demoAnalytics } from "./analytics";
import { DEMO_USER, demoState, makeObject } from "./data";

export interface DemoResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const ok = (body: unknown, status = 200): DemoResponse => ({ status, body });
const noContent = (): DemoResponse => ({ status: 204, body: null });
const fail = (status: number, code: string, message: string): DemoResponse => ({
  status,
  body: { error: { code, message, requestId: "demo" } },
});

const uuid = () => crypto.randomUUID();
const secret = (prefix: string) =>
  prefix + Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32);

const guessType = (key: string, declared?: string) => {
  if (declared && declared !== "application/octet-stream") return declared;
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
    pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", txt: "text/plain", csv: "text/csv", json: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
};

function listObjects(bucket: string, query: URLSearchParams) {
  const st = demoState();
  let items = [...(st.objects[bucket] ?? [])];
  const prefix = query.get("prefix");
  const text = query.get("q")?.toLowerCase();
  const kind = query.get("kind");
  if (prefix) items = items.filter((o) => o.key.startsWith(prefix));
  if (text) items = items.filter((o) => o.key.toLowerCase().includes(text));
  if (kind) items = items.filter((o) => o.kind === kind);
  const sort = query.get("sort") ?? "name";
  const dir = query.get("dir") === "desc" ? -1 : 1;
  const val = (o: StoredObject) => (sort === "size" ? o.size : sort === "created" ? o.createdAt : o.key);
  items.sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = x < y ? -1 : x > y ? 1 : a.key < b.key ? -1 : 1;
    return c * dir;
  });
  const limit = Math.min(Number(query.get("limit") ?? 50) || 50, 200);
  const offset = query.get("cursor") ? (JSON.parse(atob(query.get("cursor")!)) as { o: number }).o : 0;
  const page = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? btoa(JSON.stringify({ o: offset + limit })) : null;
  return { items: page, nextCursor: next };
}

/** In-memory implementation of the API surface the dashboard uses (demo mode and tests). */
export function handleDemo(method: string, rawUrl: string, body?: unknown, chunkBytes?: number): DemoResponse {
  const url = new URL(rawUrl, "http://demo.local");
  const path = url.pathname;
  const q = url.searchParams;
  const st = demoState();
  let m: RegExpExecArray | null;

  if (path === "/v1/me") return ok(DEMO_USER);

  if (path === "/v1/projects") {
    if (method === "GET") return ok(st.projects);
    if (method === "POST") {
      const name = (body as { name?: string })?.name?.trim();
      if (!name || name.length < 2) return fail(400, "validation_error", "name must be at least 2 characters");
      const p = { id: uuid(), name, quotaBytes: 500 * 1024 ** 2, usedBytes: 0, createdAt: new Date().toISOString() };
      st.projects.unshift(p);
      st.keys[p.id] = [];
      st.webhooks[p.id] = [];
      st.deliveries[p.id] = [];
      return ok(p, 201);
    }
  }

  if ((m = /^\/v1\/projects\/([^/]+)(\/.*)?$/.exec(path))) {
    const pid = m[1]!;
    const rest = m[2] ?? "";
    const project = st.projects.find((p) => p.id === pid);
    if (!project) return fail(404, "project_not_found", "Project not found");

    if (rest === "" && method === "GET") return ok(project);

    if (rest === "/keys") {
      if (method === "GET") return ok(st.keys[pid] ?? []);
      if (method === "POST") {
        const b = body as { name?: string; scope?: "read" | "write" };
        if (!b.name) return fail(400, "validation_error", "name is required");
        const s = secret("bd_live_");
        const key = { id: uuid(), name: b.name, prefix: s.slice(0, 14), scope: b.scope ?? "read", createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null };
        (st.keys[pid] ??= []).unshift(key);
        return ok({ ...key, secret: s }, 201);
      }
    }
    if ((m = /^\/keys\/([^/]+)$/.exec(rest)) && method === "DELETE") {
      const key = st.keys[pid]?.find((k) => k.id === m![1]);
      if (!key) return fail(404, "key_not_found", "API key not found");
      key.revokedAt = new Date().toISOString();
      return ok(key);
    }

    if (rest === "/buckets") {
      if (method === "GET") {
        return ok(
          st.buckets
            .filter((b) => b.projectId === pid)
            .map((b) => {
              const objs = st.objects[b.name] ?? [];
              return { ...b, objectCount: objs.length, totalBytes: objs.reduce((a, o) => a + o.size, 0) };
            }),
        );
      }
      if (method === "POST") {
        const b = body as { name?: string; isPublic?: boolean };
        if (!b.name || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(b.name)) return fail(400, "validation_error", "Invalid bucket name");
        if (st.buckets.some((x) => x.name === b.name)) return fail(409, "bucket_exists", `Bucket "${b.name}" already exists`);
        const bucket = { id: uuid(), projectId: pid, name: b.name, isPublic: Boolean(b.isPublic), createdAt: new Date().toISOString(), objectCount: 0, totalBytes: 0 };
        st.buckets.push(bucket);
        st.objects[bucket.name] = [];
        return ok(bucket, 201);
      }
    }

    if ((m = /^\/buckets\/([^/]+)(\/.*)?$/.exec(rest))) {
      const name = m[1]!;
      const sub = m[2] ?? "";
      const bucket = st.buckets.find((b) => b.projectId === pid && b.name === name);
      if (!bucket) return fail(404, "bucket_not_found", `Bucket "${name}" not found`);
      const objs = (st.objects[name] ??= []);

      if (sub === "" && method === "DELETE") {
        if (objs.length) return fail(409, "bucket_not_empty", "Delete the bucket's files first");
        st.buckets.splice(st.buckets.indexOf(bucket), 1);
        return noContent();
      }
      if (sub === "/objects" && method === "GET") return ok(listObjects(name, q));
      if (sub === "/objects" && method === "DELETE") {
        const i = objs.findIndex((o) => o.key === q.get("key"));
        if (i < 0) return fail(404, "object_not_found", "File not found");
        project.usedBytes = Math.max(0, project.usedBytes - objs[i]!.size);
        objs.splice(i, 1);
        return noContent();
      }
      if (sub === "/sign" && method === "POST") {
        const b = body as { key: string; expiresInSeconds?: number };
        const exp = Math.floor(Date.now() / 1000) + (b.expiresInSeconds ?? 3600);
        const path = b.key.split("/").map(encodeURIComponent).join("/");
        return ok({ url: `/f/${name}/${path}?exp=${exp}&sig=demo`, expiresAt: new Date(exp * 1000).toISOString() });
      }
      if (sub === "/uploads" && method === "POST") {
        const b = body as { key: string; size: number; sha256: string; contentType?: string };
        if (project.usedBytes + b.size > project.quotaBytes) return fail(413, "quota_exceeded", "Project storage quota exceeded");
        const session: UploadSession & { projectId: string; contentType: string } = {
          id: uuid(), key: b.key, bucket: name, size: b.size, offset: 0, chunkSize: 1024 * 1024,
          status: "active", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), object: null,
          projectId: pid, contentType: guessType(b.key, b.contentType),
        };
        st.uploads.set(session.id, session);
        if (b.size === 0) completeUpload(session);
        return ok(session, 201);
      }
    }

    if ((m = /^\/uploads\/([^/]+)$/.exec(rest))) {
      const s = st.uploads.get(m[1]!);
      if (!s) return fail(404, "upload_not_found", "Upload session not found");
      if (method === "GET") return ok(s, 200);
      if (method === "DELETE") {
        s.status = "cancelled";
        return noContent();
      }
      if (method === "PATCH") {
        if (s.status !== "active") return fail(409, "upload_closed", `Upload is ${s.status}`);
        const offset = Number((body as { offset?: number })?.offset ?? s.offset);
        if (offset !== s.offset) return { status: 409, body: { error: { code: "offset_mismatch", message: "Offset does not match the server", currentOffset: s.offset } }, headers: { "upload-offset": String(s.offset) } };
        s.offset = Math.min(s.size, s.offset + (chunkBytes ?? 0));
        if (s.offset >= s.size) completeUpload(s);
        return { status: 200, body: s, headers: { "upload-offset": String(s.offset) } };
      }
    }

    if (rest === "/analytics" && method === "GET") {
      return ok(
        demoAnalytics({
          from: q.get("from") ?? undefined,
          to: q.get("to") ?? undefined,
          bucket: q.get("bucket") ?? undefined,
          kind: (q.get("kind") as never) ?? undefined,
          granularity: (q.get("granularity") as never) ?? undefined,
        }),
      );
    }
    if (rest === "/analytics/refresh" && method === "POST") return ok({ groups: 4 });

    if (rest === "/webhooks") {
      if (method === "GET") return ok(st.webhooks[pid] ?? []);
      if (method === "POST") {
        const b = body as { url?: string; events?: string[] };
        try {
          new URL(b.url ?? "");
        } catch {
          return fail(400, "validation_error", "url must be a valid URL");
        }
        const ep = { id: uuid(), url: b.url!, events: (b.events ?? ["object.created", "object.deleted", "upload.failed"]) as never, active: true, createdAt: new Date().toISOString() };
        (st.webhooks[pid] ??= []).unshift(ep);
        return ok({ ...ep, secret: secret("whsec_") }, 201);
      }
    }
    if (rest === "/webhooks/deliveries" && method === "GET") {
      let all = st.deliveries[pid] ?? [];
      const status = q.get("status");
      if (status) all = all.filter((d) => d.status === status);
      const limit = Math.min(Number(q.get("limit") ?? 50) || 50, 200);
      const offset = q.get("cursor") ? (JSON.parse(atob(q.get("cursor")!)) as { o: number }).o : 0;
      return ok({
        items: all.slice(offset, offset + limit),
        nextCursor: offset + limit < all.length ? btoa(JSON.stringify({ o: offset + limit })) : null,
      });
    }
    if ((m = /^\/webhooks\/deliveries\/([^/]+)\/replay$/.exec(rest)) && method === "POST") {
      const d = st.deliveries[pid]?.find((x) => x.id === m![1]);
      if (!d) return fail(404, "delivery_not_found", "Delivery not found");
      Object.assign(d, { status: "pending", attempts: 0, lastError: null, nextAttemptAt: new Date().toISOString() });
      setTimeout(() => Object.assign(d, { status: "success", attempts: 1, lastStatusCode: 200, lastResponseMs: 74, nextAttemptAt: null }), 900);
      return ok(d);
    }
    if ((m = /^\/webhooks\/([^/]+)$/.exec(rest)) && method === "DELETE") {
      const list = st.webhooks[pid] ?? [];
      const i = list.findIndex((w) => w.id === m![1]);
      if (i < 0) return fail(404, "webhook_not_found", "Webhook not found");
      list.splice(i, 1);
      return noContent();
    }
  }

  return fail(404, "not_found", "Route not found");

  function completeUpload(s: UploadSession & { projectId: string; contentType: string }) {
    const objs = (st.objects[s.bucket] ??= []);
    const existing = objs.findIndex((o) => o.key === s.key);
    const obj = makeObject(s.key, s.size, s.contentType, Date.now(), Math.floor(Math.random() * 1e9));
    if (existing >= 0) objs.splice(existing, 1, obj);
    else objs.push(obj);
    const project = st.projects.find((p) => p.id === s.projectId);
    if (project) project.usedBytes += s.size;
    s.object = { ...obj, kind: fileKindOf(obj.contentType) };
    s.status = "complete";
    s.offset = s.size;
  }
}
