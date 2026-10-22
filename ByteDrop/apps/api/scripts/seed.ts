import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { emptyHistogram, bucketIndexForLatency } from "@bytedrop/shared";
import { createAuth } from "../src/auth";
import { loadConfig } from "../src/config";
import { runMigrations } from "../src/db/client";
import {
  analyticsHourly,
  apiKeys,
  blobs,
  buckets,
  objects,
  projects,
  user,
  webhookDeliveries,
  webhookEndpoints,
} from "../src/db/schema";
import { commitObject } from "../src/services/objects";
import { createRuntime } from "../src/runtime";
import { newSecret, sha256Hex } from "../src/util";

export const DEMO_EMAIL = "demo@bytedrop.dev";
export const DEMO_PASSWORD = "Demo#2025-pass";
const BULK = Number(process.env.SEED_BULK ?? 12000);

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function picture(i: number, w = 1600, h = 1000) {
  const hue = (i * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360},75%,35%)"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    ${Array.from({ length: 14 }, (_, k) => `<circle cx="${(k * 131 + i * 53) % w}" cy="${(k * 89 + i * 31) % h}" r="${40 + ((k * 17 + i * 7) % 120)}" fill="hsla(${(hue + k * 25) % 360},80%,70%,0.25)"/>`).join("")}
    <text x="60" y="${h - 70}" font-size="72" font-family="sans-serif" fill="white" opacity="0.9">Shot ${String(i).padStart(2, "0")}</text>
  </svg>`;
  return sharp(Buffer.from(svg));
}

function minimalPdf(text: string) {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (out += `${String(o).padStart(10, "0")} 00000 n \n`));
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

const cfg = loadConfig();
const runtime = await createRuntime(cfg, { service: "api", queue: false });
const { ctx } = runtime;
await runMigrations(ctx.db);
const auth = createAuth(ctx.db, cfg);

let [u] = await ctx.db.select().from(user).where(eq(user.email, DEMO_EMAIL));
if (!u) {
  await auth.api.signUpEmail({ body: { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "Demo Developer" } });
  [u] = await ctx.db.select().from(user).where(eq(user.email, DEMO_EMAIL));
}
const owner = u!;

const [existing] = await ctx.db.select().from(projects).where(eq(projects.ownerId, owner.id)).limit(1);
if (existing) {
  console.log("Demo data already present; nothing to do.");
  await runtime.close();
  process.exit(0);
}

const [project] = await ctx.db
  .insert(projects)
  .values({ ownerId: owner.id, name: "Acme Media", quotaBytes: 5 * 1024 ** 3 })
  .returning();
const pid = project!.id;

const mk = async (name: string, isPublic: boolean) =>
  (await ctx.db.insert(buckets).values({ projectId: pid, name, isPublic }).returning())[0]!;
const assets = await mk("acme-assets", true);
const priv = await mk("acme-private", false);
const archive = await mk("acme-archive", true);

const put = async (b: typeof assets, key: string, data: Buffer, contentType: string) => {
  const tmp = ctx.storage.tempPath(`seed-${Math.random().toString(36).slice(2)}`);
  const { writeFile, rm } = await import("node:fs/promises");
  await writeFile(tmp, data);
  await commitObject(ctx, {
    bucket: { id: b.id, name: b.name, projectId: pid },
    key,
    tmpFile: tmp,
    hash: createHash("sha256").update(data).digest("hex"),
    size: data.length,
    contentType,
  });
  await rm(tmp, { force: true });
};

for (let i = 1; i <= 14; i++) {
  const img = await picture(i);
  const folder = i <= 6 ? "hero" : i <= 10 ? "products" : "blog";
  if (i % 3 === 0) await put(assets, `${folder}/shot-${String(i).padStart(2, "0")}.jpg`, await img.jpeg({ quality: 82 }).toBuffer(), "image/jpeg");
  else if (i % 3 === 1) await put(assets, `${folder}/shot-${String(i).padStart(2, "0")}.png`, await img.png().toBuffer(), "image/png");
  else await put(assets, `${folder}/shot-${String(i).padStart(2, "0")}.webp`, await img.webp({ quality: 85 }).toBuffer(), "image/webp");
}
await put(assets, "brand/logo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="24" fill="#4f46e5"/><path d="M30 80 L60 30 L90 80 Z" fill="white"/></svg>'), "image/svg+xml");
await put(assets, "docs/handbook.pdf", minimalPdf("ByteDrop demo handbook"), "application/pdf");
await put(assets, "data/readme.txt", Buffer.from("Sample files for the ByteDrop demo project.\n"), "text/plain");
await put(assets, "data/export.csv", Buffer.from("id,name,plan\n1,Ada,pro\n2,Linus,free\n"), "text/csv");
await put(priv, "invoices/2025-09.pdf", minimalPdf("Invoice 2025-09"), "application/pdf");
await put(priv, "invoices/2025-10.pdf", minimalPdf("Invoice 2025-10"), "application/pdf");
await put(priv, "contracts/msa.pdf", minimalPdf("Master services agreement"), "application/pdf");

// A large listing to exercise the virtualised file browser: thousands of rows sharing one blob.
const placeholder = Buffer.from("archived record placeholder\n");
const hash = createHash("sha256").update(placeholder).digest("hex");
const { writeFile } = await import("node:fs/promises");
const tmp = ctx.storage.tempPath("seed-archive");
await writeFile(tmp, placeholder);
await ctx.storage.put(tmp, hash);
await ctx.db.insert(blobs).values({ hash, size: placeholder.length, refCount: BULK }).onConflictDoNothing();
const start = Date.now() - BULK * 60_000;
for (let off = 0; off < BULK; off += 2000) {
  const rows = [];
  for (let i = off; i < Math.min(off + 2000, BULK); i++) {
    const month = String((i % 12) + 1).padStart(2, "0");
    rows.push({
      bucketId: archive.id,
      key: `2025/${month}/report-${String(i).padStart(5, "0")}.txt`,
      blobHash: hash,
      size: placeholder.length,
      contentType: "text/plain",
      kind: "text",
      createdAt: new Date(start + i * 60_000),
      updatedAt: new Date(start + i * 60_000),
    });
  }
  await ctx.db.insert(objects).values(rows);
}
await ctx.db
  .update(projects)
  .set({ usedBytes: (await ctx.db.select().from(projects).where(eq(projects.id, pid)))[0]!.usedBytes + BULK * placeholder.length })
  .where(eq(projects.id, pid));

// API keys and a webhook endpoint pointing at the local receiver.
const readSecret = newSecret("bd_live_");
const writeSecret = newSecret("bd_live_");
await ctx.db.insert(apiKeys).values([
  { projectId: pid, name: "Website (read)", scope: "read", prefix: readSecret.slice(0, 14), keyHash: sha256Hex(readSecret), lastUsedAt: new Date(Date.now() - 3_600_000) },
  { projectId: pid, name: "CI uploader (write)", scope: "write", prefix: writeSecret.slice(0, 14), keyHash: sha256Hex(writeSecret) },
]);
const [endpoint] = await ctx.db
  .insert(webhookEndpoints)
  .values({ projectId: pid, url: "http://127.0.0.1:4010/hook", secret: "whsec_demo_secret", events: ["object.created", "object.deleted", "upload.failed"] })
  .returning();

// Two weeks of synthetic hourly analytics with a daily rhythm.
const rand = rng(42);
const hourMs = 3_600_000;
const nowHour = Math.floor(Date.now() / hourMs) * hourMs;
const refs = ["www.acme.dev", "shop.acme.dev", "news.ycombinator.com", "(direct)", "blog.example.org"];
const rows = [];
for (const [b, kind, weight, avgBytes] of [
  [assets, "image", 1, 220_000],
  [assets, "text", 0.12, 900],
  [assets, "pdf", 0.05, 60_000],
  [archive, "text", 0.2, 30],
] as const) {
  for (let h = 14 * 24; h >= 0; h--) {
    const hour = nowHour - h * hourMs;
    const hod = new Date(hour).getUTCHours();
    const rhythm = 0.55 + 0.45 * Math.sin(((hod - 8) / 24) * 2 * Math.PI);
    const requests = Math.max(1, Math.round(weight * (900 * rhythm + rand() * 160) * (1 + (14 * 24 - h) / 900)));
    const hits = Math.round(requests * (0.9 + rand() * 0.08));
    const hist = emptyHistogram();
    const samples: number[] = [];
    for (let s = 0; s < Math.min(requests, 200); s++) {
      const ms = Math.round(4 + Math.exp(rand() * 3.2) * (kind === "image" ? 3 : 1.4));
      samples.push(ms);
      hist[bucketIndexForLatency(ms)]! += Math.max(1, Math.round(requests / Math.min(requests, 200)));
    }
    samples.sort((a, c) => a - c);
    const files: Record<string, { requests: number; bytes: number }> = {};
    const names = kind === "image" ? ["hero/shot-01.png", "hero/shot-03.jpg", "products/shot-07.png", "blog/shot-12.webp", "brand/logo.svg"] : kind === "pdf" ? ["docs/handbook.pdf"] : ["data/export.csv", "data/readme.txt"];
    names.forEach((n, i) => {
      const r = Math.round(requests * (0.4 / (i + 1)));
      files[n] = { requests: r, bytes: r * avgBytes };
    });
    const referrers: Record<string, number> = {};
    refs.forEach((r, i) => (referrers[r] = Math.round(requests * (0.45 / (i + 1)))));
    rows.push({
      projectId: pid,
      bucketId: b.id,
      bucket: b.name,
      kind,
      hour: new Date(hour),
      requests,
      bytes: requests * avgBytes,
      cacheHits: hits,
      cacheMisses: requests - hits,
      p95Ms: samples[Math.floor(samples.length * 0.95)] ?? 10,
      latencyHist: hist,
      topFiles: files,
      topReferrers: referrers,
    });
  }
}
for (let i = 0; i < rows.length; i += 500) await ctx.db.insert(analyticsHourly).values(rows.slice(i, i + 500));

// A believable delivery log: mostly healthy with a failed burst and a few pending retries.
const deliveries = [];
for (let i = 0; i < 40; i++) {
  const failed = i >= 8 && i < 13;
  const pending = i < 2;
  deliveries.push({
    projectId: pid,
    endpointId: endpoint!.id,
    outboxId: 1000 + i,
    eventType: i % 5 === 0 ? "object.deleted" : "object.created",
    payload: { bucket: "acme-assets", object: { key: `hero/shot-${String((i % 14) + 1).padStart(2, "0")}.png`, size: 120_000 + i * 913 } },
    status: pending ? ("pending" as const) : failed ? ("failed" as const) : ("success" as const),
    attempts: pending ? 2 : failed ? 6 : 1,
    lastStatusCode: pending || failed ? 503 : 200,
    lastResponseMs: pending || failed ? 5000 : 40 + ((i * 37) % 160),
    lastError: pending || failed ? "receiver responded 503" : null,
    nextAttemptAt: pending ? new Date(Date.now() + 90_000) : null,
    createdAt: new Date(Date.now() - i * 17 * 60_000),
    updatedAt: new Date(Date.now() - i * 17 * 60_000),
  });
}
await ctx.db.insert(webhookDeliveries).values(deliveries);

console.log("Seeded demo data.");
console.log(`  login:      ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
console.log(`  read key:   ${readSecret}`);
console.log(`  write key:  ${writeSecret}`);
console.log(`  files:      acme-assets (public), acme-private (private), acme-archive (${BULK} files)`);
await runtime.close();
process.exit(0);

