import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

export const ORIGIN = 'http://localhost:5173';

export async function createTestApp() {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', WEB_ORIGIN: ORIGIN, DEV_LOGIN: 'true' });
  const { db, pool } = createDb(process.env.DATABASE_URL!);
  await runMigrations(db);
  await db.execute(sql`truncate users, workspaces cascade`);
  const app = await buildApp({ config, db, pool });
  await app.ready();

  async function login(name: string) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-login', payload: { name } });
    const cookie = res.cookies.find((c) => c.name === 'quack_sid')!;
    const user = res.json() as { id: string; name: string };
    const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
      app.inject({
        method,
        url: `/api/v1${url}`,
        payload: payload as object | undefined,
        cookies: { quack_sid: cookie.value },
        headers: { origin: ORIGIN },
      });
    return { user, call, cookie: cookie.value };
  }

  return {
    app,
    login,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}
export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
export type TestUser = Awaited<ReturnType<TestApp['login']>>;
