// Local load test: starts an isolated stack, signs in as the demo user, and measures delivery and API throughput.
// k6 users can run load/k6-delivery.js against any running instance instead.
import autocannon from "autocannon";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ports, startStack, stackUrls, stopStack } from "./e2e-stack.mjs";
import { root } from "./lib/proc.mjs";

process.env.RATE_LIMIT_PER_MIN ??= "10000000";
const seconds = Number(process.env.LOADTEST_SECONDS ?? 8);
const connections = Number(process.env.LOADTEST_CONNECTIONS ?? 64);

async function json(res) {
  if (!res.ok) throw new Error(`${res.url} -> ${res.status}`);
  return res.json();
}

await startStack();
try {
  const api = stackUrls.api;
  const signIn = await fetch(`${stackUrls.web}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: stackUrls.web },
    body: JSON.stringify({ email: "demo@bytedrop.dev", password: "Demo#2025-pass" }),
  });
  if (!signIn.ok) throw new Error(`sign-in failed: ${signIn.status}`);
  const cookie = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const [project] = await json(await fetch(`${api}/v1/projects`, { headers: { cookie, origin: stackUrls.web } }));
  const key = await json(
    await fetch(`${api}/v1/projects/${project.id}/keys`, {
      method: "POST",
      headers: { cookie, origin: stackUrls.web, "content-type": "application/json" },
      body: JSON.stringify({ name: "load test", scope: "read" }),
    }),
  );
  const bearer = { authorization: `Bearer ${key.secret}` };

  const png = `${api}/f/acme-assets/hero/shot-01.png`;
  const first = await fetch(png);
  const etag = first.headers.get("etag");
  const sizeBytes = (await first.arrayBuffer()).byteLength;
  await fetch(`${png}?w=400&format=webp`); // prime the transform cache

  const scenarios = [
    { name: "Baseline: GET /health", url: `${api}/health`, note: "framework floor, no database" },
    { name: "Delivery: original file (200)", url: png, note: `${(sizeBytes / 1024).toFixed(0)} KB body` },
    { name: "Delivery: conditional request (304)", url: png, headers: { "if-none-match": etag }, note: "no body" },
    { name: "Delivery: cached image transform", url: `${png}?w=400&format=webp`, note: "w=400 webp from the disk cache" },
    { name: "Delivery: range request (206)", url: png, headers: { range: "bytes=0-65535" }, note: "first 64 KB" },
    { name: "API: list files (API key)", url: `${api}/v1/projects/${project.id}/buckets/acme-assets/objects?limit=50`, headers: bearer, note: "cursor-paginated query" },
    { name: "API: analytics (API key)", url: `${api}/v1/projects/${project.id}/analytics?from=${new Date(Date.now() - 7 * 86400000).toISOString()}`, headers: bearer, note: "7 days of hourly rollups" },
  ];

  const results = [];
  for (const s of scenarios) {
    process.stdout.write(`${s.name} ... `);
    const r = await autocannon({ url: s.url, headers: s.headers, connections, duration: seconds });
    const row = {
      scenario: s.name,
      note: s.note,
      requestsPerSecond: Math.round(r.requests.average),
      latencyMs: { p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, max: r.latency.max },
      throughputMBps: Number((r.throughput.average / 1024 / 1024).toFixed(1)),
      non2xx: r.non2xx,
      errors: r.errors,
    };
    results.push(row);
    console.log(`${row.requestsPerSecond} req/s, p99 ${row.latencyMs.p99} ms, non-2xx ${row.non2xx}`);
  }

  const out = path.join(root, "docs", "loadtest-results.json");
  writeFileSync(
    out,
    JSON.stringify({ generatedAt: new Date().toISOString(), connections, secondsPerScenario: seconds, ports, results }, null, 2),
  );
  console.log(`\nWrote ${out}`);
} finally {
  stopStack();
}
process.exit(0);
