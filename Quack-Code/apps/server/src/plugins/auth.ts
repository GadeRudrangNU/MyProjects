import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { and, eq, gt } from 'drizzle-orm';
import { can, type Action, type Role, type User } from '@quack/shared';
import type { Config } from '../config.js';
import { schema, type Db } from '../db/client.js';
import { sha256, randomToken } from '../crypto.js';
import { forbidden, notFound, unauthorized, HttpError } from '../errors.js';

export const SESSION_COOKIE = 'quack_sid';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
  interface FastifyInstance {
    db: Db;
    config: Config;
    pool: { query: (q: string) => Promise<unknown> };
    createSession(userId: string): Promise<{ token: string; expiresAt: Date }>;
    requireUser(req: FastifyRequest): User;
    requireRole(req: FastifyRequest, workspaceId: string, action: Action): Promise<Role>;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  const { db, config } = app;
  app.decorateRequest('user', null);

  app.decorate('createSession', async (userId: string) => {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + config.SESSION_DAYS * 86_400_000);
    await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt });
    return { token, expiresAt };
  });

  app.decorate('requireUser', (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    return req.user;
  });

  // Non-members get 404 so workspace existence is not leaked; members lacking the action get 403.
  app.decorate('requireRole', async (req: FastifyRequest, workspaceId: string, action: Action) => {
    const user = app.requireUser(req);
    const [m] = await db
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, user.id)));
    if (!m) throw notFound('Workspace');
    if (!can(m.role, action)) throw forbidden();
    return m.role;
  });

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const [row] = await db
      .select({ id: schema.users.id, name: schema.users.name, avatarUrl: schema.users.avatarUrl })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())));
    req.user = row ?? null;
  });

  // CSRF defence in depth on top of SameSite: unsafe requests must come from our web origin.
  app.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (!req.cookies[SESSION_COOKIE]) return;
    if (req.headers.origin !== config.WEB_ORIGIN) {
      throw new HttpError(403, 'bad_origin', 'Cross-origin request blocked');
    }
  });
});
