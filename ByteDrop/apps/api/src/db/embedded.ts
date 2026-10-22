import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

export interface EmbeddedDb {
  pg: EmbeddedPostgres;
  url(database: string): string;
  createDatabase(name: string): Promise<void>;
  stop(): Promise<void>;
}

export async function startEmbeddedPostgres(opts: {
  dir: string;
  port: number;
  persistent?: boolean;
  quiet?: boolean;
}): Promise<EmbeddedDb> {
  const pg = new EmbeddedPostgres({
    databaseDir: opts.dir,
    user: "postgres",
    password: "postgres",
    port: opts.port,
    persistent: opts.persistent ?? true,
    onLog: opts.quiet === false ? (m) => console.log(String(m).trim()) : () => {},
    onError: () => {},
  });
  if (!existsSync(path.join(opts.dir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  return {
    pg,
    url: (database) => `postgres://postgres:postgres@127.0.0.1:${opts.port}/${database}`,
    createDatabase: async (name) => {
      try {
        await pg.createDatabase(name);
      } catch (e) {
        if (!String((e as Error).message).includes("already exists")) throw e;
      }
    },
    stop: () => pg.stop(),
  };
}
