import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: path.resolve(here, '../../drizzle') });
}
