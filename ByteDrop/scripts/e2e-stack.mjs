// Brings up an isolated stack for browser tests: embedded Postgres, API, worker, webhook receiver, web.
import { rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { apiDir, kill, nextCli, root, start, tsxCli, waitForHttp, webDir } from "./lib/proc.mjs";

export const ports = { pg: 54360, api: 4100, worker: 4101, receiver: 4110, web: 3100 };
const dataDir = path.join(root, ".data-e2e");
const logDir = path.join(dataDir, "logs");
const children = [];

export const stackUrls = {
  web: `http://127.0.0.1:${ports.web}`,
  api: `http://127.0.0.1:${ports.api}`,
  receiver: `http://127.0.0.1:${ports.receiver}`,
};

async function assertPortsFree() {
  const net = await import("node:net");
  for (const [name, port] of Object.entries(ports)) {
    const busy = await new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
      s.on("error", () => resolve(false));
    });
    if (busy) throw new Error(`Port ${port} (${name}) is already in use. Stop whatever is listening there and try again.`);
  }
}

export async function startStack() {
  await assertPortsFree();
  rmSync(dataDir, { recursive: true, force: true });
  const env = {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${ports.pg}/bytedrop`,
    PORT: String(ports.api),
    WORKER_PORT: String(ports.worker),
    HOST: "127.0.0.1",
    PUBLIC_URL: stackUrls.api,
    WEB_ORIGIN: stackUrls.web,
    LOG_LEVEL: "warn",
    RATE_LIMIT_PER_MIN: process.env.RATE_LIMIT_PER_MIN ?? "100000",
    WEBHOOK_BACKOFF_MS: "400",
    WEBHOOK_TIMEOUT_MS: "1500",
    WEBHOOK_MAX_ATTEMPTS: "3",
    WEBHOOK_BREAKER: "off",
    SEED_BULK: "1500",
    AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0000",
  };
  const opts = { cwd: apiDir, env, logDir };

  children.push(start("db", [tsxCli, "scripts/dev-db.ts"], opts));
  await waitForPort(ports.pg);
  await waitFor(() => run(tsxCli, ["scripts/seed.ts"], opts), "seed");

  // E2E_API_NODE_ARGS lets a profiler wrap the API process (for example "--cpu-prof"); tsx is then loaded in-process.
  const apiArgs = process.env.E2E_API_NODE_ARGS ? [...process.env.E2E_API_NODE_ARGS.split(" "), "--import", "tsx", "src/server.ts"] : [tsxCli, "src/server.ts"];
  children.push(start("api", apiArgs, opts));
  children.push(start("worker", [tsxCli, "src/worker.ts"], opts));
  children.push(start("receiver", [tsxCli, "scripts/receiver.ts"], { ...opts, env: { ...env, RECEIVER_PORT: String(ports.receiver), RECEIVER_SECRET: "whsec_demo_secret" } }));
  await waitForHttp(`${stackUrls.api}/ready`);
  await waitForHttp(`http://127.0.0.1:${ports.worker}/ready`);

  children.push(
    start("web", [nextCli, "start", "-p", String(ports.web), "-H", "127.0.0.1"], {
      cwd: webDir,
      env: { API_URL: stackUrls.api },
      logDir,
    }),
  );
  await waitForHttp(`${stackUrls.web}/login`);
}

export function stopStack() {
  for (const c of children.reverse()) kill(c);
  children.length = 0;
}

function run(cli, args, { cwd, env }) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
}

async function waitFor(fn, label, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      return fn();
    } catch (err) {
      if (i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(label);
}

async function waitForPort(port) {
  const net = await import("node:net");
  for (let i = 0; i < 120; i++) {
    const ok = await new Promise((res) => {
      const s = net.connect(port, "127.0.0.1", () => {
        s.destroy();
        res(true);
      });
      s.on("error", () => res(false));
    });
    if (ok) {
      await new Promise((r) => setTimeout(r, 2500));
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`port ${port} never opened`);
}
