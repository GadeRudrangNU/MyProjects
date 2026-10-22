import { loadConfig } from "./config";
import { registerWorkers, startOutboxRelay, startWorkerHttp } from "./jobs/handlers";
import { createRuntime } from "./runtime";
import { initTelemetry, shutdownTelemetry } from "./telemetry";

const cfg = loadConfig();
initTelemetry("bytedrop-worker", cfg);

const runtime = await createRuntime(cfg, { service: "worker" });
const { ctx, boss } = runtime;

await registerWorkers(ctx, boss!);
const stopRelay = startOutboxRelay(ctx);
const http = startWorkerHttp(ctx, cfg.WORKER_PORT, cfg.HOST);
ctx.log.info({ port: cfg.WORKER_PORT }, "worker running");

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  ctx.log.info({ signal }, "worker shutting down");
  stopRelay();
  http.close();
  await runtime.close();
  await shutdownTelemetry();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
