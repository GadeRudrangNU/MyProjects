import path from 'node:path';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { startEmbeddedPostgres, type EmbeddedDb } from './db/embedded.js';
import { buildApp } from './app.js';

const config = loadConfig();
let embedded: EmbeddedDb | undefined;

// No DATABASE_URL in development means "use the local embedded Postgres" (no Docker needed).
let databaseUrl = config.DATABASE_URL;
if (!databaseUrl) {
  if (config.isProd) throw new Error('DATABASE_URL is required in production');
  embedded = await startEmbeddedPostgres({
    dir: path.resolve(config.EMBEDDED_PG_DIR),
    port: config.EMBEDDED_PG_PORT,
    persistent: true,
  });
  databaseUrl = embedded.url;
}

const { db, pool } = createDb(databaseUrl);
await runMigrations(db);
const app = await buildApp({ config, db, pool });

const shutdown = async () => {
  await app.close();
  await pool.end();
  await embedded?.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: '0.0.0.0' });
