import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startEmbeddedPostgres, type EmbeddedDb } from "../src/db/embedded";

let pg: EmbeddedDb | undefined;
let dir = "";

export async function setup() {
  dir = mkdtempSync(path.join(os.tmpdir(), "bytedrop-pg-"));
  const port = 54341;
  pg = await startEmbeddedPostgres({ dir, port, persistent: false });
  process.env.TEST_PG_PORT = String(port);
}

function killTree() {
  const pid = (pg?.pg as unknown as { process?: { pid?: number } } | undefined)?.process?.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    else process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

export async function teardown() {
  // Never let a slow shutdown keep the test runner alive.
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([pg?.stop().catch(() => {}), new Promise((r) => (timer = setTimeout(r, 15_000)))]);
  clearTimeout(timer);
  killTree();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
