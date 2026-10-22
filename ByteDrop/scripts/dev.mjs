// Starts the whole stack for local development: Postgres, API, worker, a webhook receiver and the web app.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { apiDir, kill, nextCli, root, start, tsxCli, waitForHttp, webDir } from "./lib/proc.mjs";

const ports = { api: 4000, worker: 4001, receiver: 4010, web: 3000 };
const logDir = path.join(root, ".data", "logs");
const env = { DATA_DIR: path.join(root, ".data"), RECEIVER_SECRET: "whsec_demo_secret", RECEIVER_PORT: String(ports.receiver) };
const children = [];

function stop() {
  for (const c of children.reverse()) kill(c);
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const run = (label, args, cwd = apiDir) => {
  const r = spawnSync(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${label} failed`);
};
const spawnProc = (name, args, cwd = apiDir, extra = {}) =>
  children.push(start(name, args, { cwd, env: { ...env, ...extra }, logDir, prefix: true }));

console.log("Starting Postgres (embedded, data in .data/pg)...");
spawnProc("db", [tsxCli, "scripts/dev-db.ts"]);
await waitForPostgres();

console.log("Loading demo data (skipped if it already exists)...");
run("seed", [tsxCli, "scripts/seed.ts"]);

spawnProc("api", [tsxCli, "watch", "src/server.ts"]);
spawnProc("worker", [tsxCli, "watch", "src/worker.ts"]);
spawnProc("receiver", [tsxCli, "scripts/receiver.ts"]);
await waitForHttp(`http://127.0.0.1:${ports.api}/ready`);
spawnProc("web", [nextCli, "dev", "-p", String(ports.web)], webDir, { API_URL: `http://127.0.0.1:${ports.api}` });
await waitForHttp(`http://127.0.0.1:${ports.web}/login`, 120_000);

console.log(`
ByteDrop is running
  Dashboard   http://localhost:${ports.web}   (demo@bytedrop.dev / Demo#2025-pass)
  API docs    http://localhost:${ports.api}/docs
  Metrics     http://localhost:${ports.api}/metrics   worker: http://localhost:${ports.worker}/metrics
  Webhooks    receiver on http://127.0.0.1:${ports.receiver}/hook  (POST /mode?m=fail|hang|ok to misbehave)
Press Ctrl+C to stop everything.`);

async function waitForPostgres() {
  const net = await import("node:net");
  for (let i = 0; i < 120; i++) {
    const open = await new Promise((resolve) => {
      const s = net.connect(54340, "127.0.0.1", () => (s.destroy(), resolve(true)));
      s.on("error", () => resolve(false));
    });
    if (open) {
      await new Promise((r) => setTimeout(r, 2500));
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Postgres did not start");
}
