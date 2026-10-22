import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "apps/api");
const webDir = path.join(root, "apps/web");

export const tsxCli = createRequire(path.join(apiDir, "package.json")).resolve("tsx/cli");
export const nextCli = createRequire(path.join(webDir, "package.json")).resolve("next/dist/bin/next");

/** Starts a long-running node process, tees output to a log file and returns the child. */
export function start(name, args, { cwd, env = {}, logDir, prefix = false } = {}) {
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(path.join(logDir, `${name}.log`), { flags: "a" });
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const pipe = (stream, out) =>
    stream.on("data", (d) => {
      log.write(d);
      if (prefix) {
        for (const line of String(d).split(/\r?\n/)) if (line.trim()) out.write(`[${name}] ${line}\n`);
      }
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => log.end(`\nexited ${code}\n`));
  return child;
}

export function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

export async function waitForHttp(url, timeoutMs = 60_000, ok = (s) => s < 500) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (ok(res.status)) return;
      last = `status ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

export { apiDir, webDir };
