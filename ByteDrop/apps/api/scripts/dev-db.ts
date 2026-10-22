import path from "node:path";
import { loadConfig } from "../src/config";
import { createDb, runMigrations } from "../src/db/client";
import { startEmbeddedPostgres } from "../src/db/embedded";

const cfg = loadConfig();
const port = Number(new URL(cfg.DATABASE_URL).port || 54340);
const dir = path.join(cfg.DATA_DIR, "pg");

const pg = await startEmbeddedPostgres({ dir, port, persistent: true });
await pg.createDatabase("bytedrop");

const { db, pool } = createDb(cfg.DATABASE_URL, 2);
await runMigrations(db);
await pool.end();
console.log(`postgres ready on ${port}`);

async function stop() {
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
setInterval(() => {}, 1 << 30);
