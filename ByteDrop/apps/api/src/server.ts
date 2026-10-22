import { createAuth } from "./auth";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { runMigrations } from "./db/client";
import { createRuntime } from "./runtime";
import { initTelemetry, shutdownTelemetry } from "./telemetry";

const cfg = loadConfig();
initTelemetry("bytedrop-api", cfg);

const runtime = await createRuntime(cfg, { service: "api" });
const { ctx } = runtime;
await runMigrations(ctx.db);

const auth = createAuth(ctx.db, cfg);
const app = await buildApp(ctx, auth);

await app.listen({ port: cfg.PORT, host: cfg.HOST });
ctx.log.info({ port: cfg.PORT }, "api listening");

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  ctx.log.info({ signal }, "shutting down");
  await app.close();
  await runtime.close();
  await shutdownTelemetry();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
