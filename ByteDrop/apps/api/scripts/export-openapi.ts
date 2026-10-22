import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth";
import { loadConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

// Builds the app against an unreachable database just to read the generated OpenAPI document.
const cfg = loadConfig({ LOG_LEVEL: "silent" });
const runtime = await createRuntime(cfg, { service: "api", queue: false });
const app = await buildApp(runtime.ctx, createAuth(runtime.ctx.db, cfg));
await app.ready();
const out = path.resolve(process.argv[2] ?? "openapi.json");
writeFileSync(out, JSON.stringify(app.swagger(), null, 2));
console.log(`wrote ${out}`);
await app.close();
await runtime.close();
process.exit(0);
