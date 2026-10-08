import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface EmbeddedDb {
  url: string;
  stop: () => Promise<void>;
}

/**
 * Real PostgreSQL, no Docker. Dev keeps its data dir between runs; tests use a throwaway one.
 */
export async function startEmbeddedPostgres(opts: { dir?: string; port: number; persistent: boolean }): Promise<EmbeddedDb> {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'quack-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'quack',
    password: 'quack',
    port: opts.port,
    persistent: opts.persistent,
    onLog: () => {},
    onError: () => {},
  });
  if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  const exists = await client.query("select 1 from pg_database where datname = 'quack'");
  if (exists.rowCount === 0) await client.query('create database quack');
  await client.end();
  return {
    url: `postgres://quack:quack@localhost:${opts.port}/quack`,
    stop: async () => {
      await pg.stop();
      if (!opts.persistent) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
