import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(connectionString: string, max = 10) {
  const pool = new pg.Pool({ connectionString, max });
  pool.on("error", () => {});
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export async function runMigrations(db: Db) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../drizzle"),
    path.resolve(here, "../drizzle"),
    path.resolve(here, "./drizzle"),
  ];
  const { existsSync } = await import("node:fs");
  const folder = candidates.find((c) => existsSync(path.join(c, "meta/_journal.json")));
  if (!folder) throw new Error("migrations folder not found");
  await migrate(db, { migrationsFolder: folder });
}

export { schema };
