import { startEmbeddedPostgres } from '../src/db/embedded.js';

// Uses DATABASE_URL when set (CI runs a Postgres service container); otherwise a throwaway embedded Postgres.
export default async function setup() {
  if (process.env.DATABASE_URL) return;
  const pg = await startEmbeddedPostgres({ port: 54330, persistent: false });
  process.env.DATABASE_URL = pg.url;
  return async () => {
    await pg.stop();
  };
}
