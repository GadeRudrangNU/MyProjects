import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ShipSafeClient, type Decision, type User } from "@shipsafe/sdk";

const port = Number(process.env.DEMO_PORT ?? 5200);
const shipSafeUrl = process.env.SHIPSAFE_URL ?? "http://localhost:5080";
const sdkKey = process.env.SHIPSAFE_SDK_KEY ?? "dev-sdk-key";
const adminKey = process.env.SHIPSAFE_ADMIN_KEY ?? "dev-admin-key";
const flagKey = "new-checkout";
const publicDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "public");

const healthyErrorRate = 0.01;
const buggyErrorRate = 0.35;
const windowSeconds = 30;

interface Bucket {
  onRequests: number;
  onErrors: number;
  offRequests: number;
  offErrors: number;
}

const buckets = new Map<number, Bucket>();
let bugShipped = false;
let trafficRps = 0;
let trafficCarry = 0;

const sdk = await ShipSafeClient.create({
  baseUrl: shipSafeUrl,
  sdkKey,
  startTimeoutMs: 2000,
  onError: (error) => console.warn(`ShipSafe: ${error instanceof Error ? error.message : error}`),
});

function checkout(user: User): { decision: Decision; ok: boolean } {
  const decision = sdk.evaluate(flagKey, user);
  const failureRate = decision.enabled ? (bugShipped ? buggyErrorRate : healthyErrorRate) : healthyErrorRate;
  const ok = Math.random() >= failureRate;
  sdk.track(decision, ok);

  const second = Math.floor(Date.now() / 1000);
  const bucket = buckets.get(second) ?? { onRequests: 0, onErrors: 0, offRequests: 0, offErrors: 0 };
  if (decision.enabled) {
    bucket.onRequests += 1;
    if (!ok) bucket.onErrors += 1;
  } else {
    bucket.offRequests += 1;
    if (!ok) bucket.offErrors += 1;
  }
  buckets.set(second, bucket);
  for (const key of buckets.keys()) {
    if (key < second - 120) buckets.delete(key);
  }
  return { decision, ok };
}

function windowTotals() {
  const from = Math.floor(Date.now() / 1000) - windowSeconds;
  const totals = { on: { requests: 0, errors: 0 }, off: { requests: 0, errors: 0 } };
  for (const [second, b] of buckets) {
    if (second < from) continue;
    totals.on.requests += b.onRequests;
    totals.on.errors += b.onErrors;
    totals.off.requests += b.offRequests;
    totals.off.errors += b.offErrors;
  }
  return totals;
}

const countries = ["US", "US", "US", "CA", "CA", "GB"];
const plans = ["free", "free", "pro", "beta"];

function randomUser(): User {
  return {
    id: `sim-${Math.floor(Math.random() * 20000)}`,
    attributes: {
      country: countries[Math.floor(Math.random() * countries.length)]!,
      plan: plans[Math.floor(Math.random() * plans.length)]!,
    },
  };
}

setInterval(() => {
  trafficCarry += trafficRps * 0.05;
  while (trafficCarry >= 1) {
    trafficCarry -= 1;
    checkout(randomUser());
  }
}, 50);

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${shipSafeUrl}/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-admin-key": adminKey, "x-actor": "demo-store", ...init.headers },
  });
}

async function latestRollback(): Promise<{ at: string; summary: string; actor: string } | null> {
  try {
    const response = await admin(`/audit?flagKey=${flagKey}&limit=20`);
    if (!response.ok) return null;
    const rows = (await response.json()) as { at: string; action: string; actor: string; summary: string }[];
    const lastRollback = rows.find((r) => r.action === "rollback" || r.action === "rollback-approved");
    const lastReenable = rows.find((r) => r.action === "updated" && r.summary.startsWith("Enabled"));
    if (!lastRollback) return null;
    if (lastReenable && rows.indexOf(lastReenable) < rows.indexOf(lastRollback)) return null;
    return { at: lastRollback.at, summary: lastRollback.summary, actor: lastRollback.actor };
  } catch {
    return null;
  }
}

async function rerelease(): Promise<boolean> {
  bugShipped = false;
  buckets.clear();
  const current = await admin(`/flags/${flagKey}`);
  if (!current.ok) return false;
  const flag = (await current.json()) as Record<string, unknown>;
  delete flag.version;
  delete flag.updatedAt;
  const response = await admin(`/flags/${flagKey}`, {
    method: "PUT",
    body: JSON.stringify({ ...flag, enabled: true, rolloutPercent: 50 }),
  });
  return response.ok;
}

async function state(user: User) {
  const flag = sdk.getFlag(flagKey);
  const rollback = flag && !flag.enabled ? await latestRollback() : null;
  return {
    connected: sdk.ready,
    flag: flag ? { enabled: flag.enabled, rolloutPercent: flag.rolloutPercent, version: flag.version } : null,
    you: sdk.evaluate(flagKey, user),
    window: windowTotals(),
    windowSeconds,
    bugShipped,
    trafficRps,
    rollback,
  };
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function userFrom(source: Record<string, unknown> | URLSearchParams): User {
  const get = (name: string) => (source instanceof URLSearchParams ? source.get(name) : (source[name] as string | undefined));
  return {
    id: String(get("userId") || "visitor"),
    attributes: { country: String(get("country") || "US"), plan: String(get("plan") || "free") },
  };
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const relative = pathname === "/" ? "index.html" : normalize(pathname).replace(/^([/\\])+/, "");
  const file = join(publicDir, relative);
  if (!file.startsWith(publicDir)) {
    send(response, 403, { error: "Forbidden" });
    return;
  }
  try {
    const content = await readFile(file);
    response.writeHead(200, { "content-type": contentTypes[extname(file)] ?? "application/octet-stream" });
    response.end(content);
  } catch {
    send(response, 404, { error: "Not found" });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/state") {
      return send(response, 200, await state(userFrom(url.searchParams)));
    }
    if (request.method === "POST" && url.pathname === "/api/checkout") {
      const { decision, ok } = checkout(userFrom(await readBody(request)));
      return send(response, 200, { ok, variant: decision.enabled ? "new" : "classic" });
    }
    if (request.method === "POST" && url.pathname === "/api/bug") {
      const body = await readBody(request);
      bugShipped = Boolean(body.on);
      return send(response, 200, { bugShipped });
    }
    if (request.method === "POST" && url.pathname === "/api/traffic") {
      const body = await readBody(request);
      trafficRps = Math.max(0, Math.min(200, Number(body.rps) || 0));
      return send(response, 200, { trafficRps });
    }
    if (request.method === "POST" && url.pathname === "/api/rerelease") {
      return send(response, 200, { ok: await rerelease() });
    }
    if (request.method === "GET") {
      return await serveStatic(url.pathname, response);
    }
    send(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    send(response, 500, { error: "Internal error" });
  }
});

server.listen(port, () => console.log(`Demo store on http://localhost:${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void sdk.close().finally(() => process.exit(0));
  });
}
