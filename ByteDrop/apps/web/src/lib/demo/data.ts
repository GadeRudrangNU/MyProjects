import {
  fileKindOf,
  type ApiKey,
  type Bucket,
  type Project,
  type StoredObject,
  type UploadSession,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "@bytedrop/shared";

export const DEMO_PROJECT_ID = "6f0c1f0e-5b1a-4a0e-9a53-0d6f3f6a1001";
export const DEMO_USER = { id: "demo-user", email: "demo@bytedrop.dev", name: "Demo Developer" };

const DAY = 86_400_000;
const NOW = () => Date.now();

export interface DemoBucket extends Bucket {
  projectId: string;
}

export interface DemoState {
  projects: Project[];
  keys: Record<string, ApiKey[]>;
  buckets: DemoBucket[];
  objects: Record<string, StoredObject[]>;
  webhooks: Record<string, WebhookEndpoint[]>;
  deliveries: Record<string, WebhookDelivery[]>;
  uploads: Map<string, UploadSession & { projectId: string; contentType: string }>;
}

function hex(n: number, len = 64) {
  let s = "";
  let x = n * 2654435761;
  while (s.length < len) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    s += x.toString(16).padStart(8, "0");
  }
  return s.slice(0, len);
}

export function makeObject(key: string, size: number, contentType: string, createdAt: number, seed: number): StoredObject {
  const sha = hex(seed);
  const iso = new Date(createdAt).toISOString();
  return {
    key,
    size,
    contentType,
    kind: fileKindOf(contentType),
    etag: `"${sha.slice(0, 32)}"`,
    sha256: sha,
    createdAt: iso,
    updatedAt: iso,
  };
}

function buildObjects() {
  const now = NOW();
  const assets: StoredObject[] = [];
  const ext = ["png", "jpg", "webp"] as const;
  const mime = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;
  for (let i = 1; i <= 14; i++) {
    const e = ext[i % 3]!;
    const folder = i <= 6 ? "hero" : i <= 10 ? "products" : "blog";
    assets.push(
      makeObject(`${folder}/shot-${String(i).padStart(2, "0")}.${e}`, 180_000 + i * 41_377, mime[e], now - i * 3 * 3_600_000, i),
    );
  }
  assets.push(makeObject("brand/logo.svg", 412, "image/svg+xml", now - 9 * DAY, 101));
  assets.push(makeObject("docs/handbook.pdf", 18_920, "application/pdf", now - 6 * DAY, 102));
  assets.push(makeObject("data/readme.txt", 44, "text/plain", now - 6 * DAY, 103));
  assets.push(makeObject("data/export.csv", 38, "text/csv", now - 5 * DAY, 104));

  const priv = [
    makeObject("invoices/2025-09.pdf", 17_400, "application/pdf", now - 40 * DAY, 201),
    makeObject("invoices/2025-10.pdf", 17_520, "application/pdf", now - 10 * DAY, 202),
    makeObject("contracts/msa.pdf", 64_100, "application/pdf", now - 80 * DAY, 203),
  ];

  const archive: StoredObject[] = [];
  const start = now - 12_000 * 60_000;
  for (let i = 0; i < 12_000; i++) {
    const month = String((i % 12) + 1).padStart(2, "0");
    archive.push(
      makeObject(`2025/${month}/report-${String(i).padStart(5, "0")}.txt`, 28 + (i % 97) * 11, "text/plain", start + i * 60_000, 1000 + i),
    );
  }
  return { assets, priv, archive };
}

export function createDemoState(): DemoState {
  const { assets, priv, archive } = buildObjects();
  const now = NOW();
  const total = [...assets, ...priv, ...archive].reduce((a, o) => a + o.size, 0);
  const projects: Project[] = [
    {
      id: DEMO_PROJECT_ID,
      name: "Acme Media",
      quotaBytes: 5 * 1024 ** 3,
      usedBytes: total,
      createdAt: new Date(now - 30 * DAY).toISOString(),
    },
  ];
  const bucket = (name: string, isPublic: boolean, objs: StoredObject[], age: number): DemoBucket => ({
    id: `00000000-0000-4000-8000-${String(900 + name.length * 7 + age).padStart(12, "0")}`,
    projectId: DEMO_PROJECT_ID,
    name,
    isPublic,
    createdAt: new Date(now - age * DAY).toISOString(),
    objectCount: objs.length,
    totalBytes: objs.reduce((a, o) => a + o.size, 0),
  });
  const buckets = [
    bucket("acme-assets", true, assets, 30),
    bucket("acme-private", false, priv, 28),
    bucket("acme-archive", true, archive, 21),
  ];
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const keys: ApiKey[] = [
    { id: uuid(1), name: "Website (read)", prefix: "bd_live_GZ20N1", scope: "read", createdAt: new Date(now - 20 * DAY).toISOString(), lastUsedAt: new Date(now - 3_600_000).toISOString(), revokedAt: null },
    { id: uuid(2), name: "CI uploader (write)", prefix: "bd_live_R_3RyH", scope: "write", createdAt: new Date(now - 12 * DAY).toISOString(), lastUsedAt: new Date(now - 2 * DAY).toISOString(), revokedAt: null },
    { id: uuid(3), name: "Old staging key", prefix: "bd_live_Qm8vTa", scope: "read", createdAt: new Date(now - 60 * DAY).toISOString(), lastUsedAt: null, revokedAt: new Date(now - 30 * DAY).toISOString() },
  ];
  const endpoint: WebhookEndpoint = {
    id: uuid(10),
    url: "https://hooks.acme.dev/bytedrop",
    events: ["object.created", "object.deleted", "upload.failed"],
    active: true,
    createdAt: new Date(now - 14 * DAY).toISOString(),
  };
  const deliveries: WebhookDelivery[] = [];
  for (let i = 0; i < 40; i++) {
    const failed = i >= 8 && i < 13;
    const pending = i < 2;
    const created = new Date(now - i * 17 * 60_000).toISOString();
    deliveries.push({
      id: uuid(100 + i),
      endpointId: endpoint.id,
      eventType: i % 5 === 0 ? "object.deleted" : "object.created",
      status: pending ? "pending" : failed ? "failed" : "success",
      attempts: pending ? 2 : failed ? 6 : 1,
      lastStatusCode: pending || failed ? 503 : 200,
      lastResponseMs: pending || failed ? 5000 : 40 + ((i * 37) % 160),
      lastError: pending || failed ? "receiver responded 503" : null,
      nextAttemptAt: pending ? new Date(now + 90_000).toISOString() : null,
      createdAt: created,
      payload: { bucket: "acme-assets", object: { key: `hero/shot-${String((i % 14) + 1).padStart(2, "0")}.png`, size: 120_000 + i * 913 } },
    });
  }
  return {
    projects,
    keys: { [DEMO_PROJECT_ID]: keys },
    buckets,
    objects: { "acme-assets": assets, "acme-private": priv, "acme-archive": archive },
    webhooks: { [DEMO_PROJECT_ID]: [endpoint] },
    deliveries: { [DEMO_PROJECT_ID]: deliveries },
    uploads: new Map(),
  };
}

let state: DemoState | null = null;
export function demoState(): DemoState {
  return (state ??= createDemoState());
}
export function resetDemoState() {
  state = null;
}
