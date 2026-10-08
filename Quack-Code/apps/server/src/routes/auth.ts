import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { userSchema } from '@quack/shared';
import { schema } from '../db/client.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { randomToken, sha256 } from '../crypto.js';
import { HttpError, notFound } from '../errors.js';

const STATE_COOKIE = 'quack_oauth_state';
const authLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

export async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, config } = app;

  const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: Date) =>
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });

  r.get('/auth/github', { config: authLimit }, async (_req, reply) => {
    if (!config.GITHUB_CLIENT_ID) throw new HttpError(501, 'oauth_not_configured', 'GitHub OAuth is not configured');
    const state = randomToken(16);
    reply.setCookie(STATE_COOKIE, sha256(state), {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 600,
    });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', config.GITHUB_CLIENT_ID);
    url.searchParams.set('redirect_uri', `${config.PUBLIC_URL}/api/v1/auth/github/callback`);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'read:user');
    return reply.redirect(url.toString());
  });

  r.get(
    '/auth/github/callback',
    { config: authLimit, schema: { querystring: z.object({ code: z.string().min(1), state: z.string().min(1) }) } },
    async (req, reply) => {
      const { code, state } = req.query;
      const expected = req.cookies[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: '/api/v1/auth' });
      if (!expected || expected !== sha256(state)) throw new HttpError(400, 'bad_state', 'Invalid OAuth state');
      if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) {
        throw new HttpError(501, 'oauth_not_configured', 'GitHub OAuth is not configured');
      }

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: config.GITHUB_CLIENT_ID,
          client_secret: config.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${config.PUBLIC_URL}/api/v1/auth/github/callback`,
        }),
      });
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      if (!tokenJson.access_token) throw new HttpError(400, 'oauth_failed', 'GitHub rejected the sign-in');

      const meRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}`, 'User-Agent': 'quack-code' },
      });
      if (!meRes.ok) throw new HttpError(502, 'oauth_failed', 'Could not read your GitHub profile');
      const gh = (await meRes.json()) as { id: number; login: string; name: string | null; avatar_url: string };

      const [user] = await db
        .insert(schema.users)
        .values({ githubId: String(gh.id), name: gh.name ?? gh.login, avatarUrl: gh.avatar_url })
        .onConflictDoUpdate({
          target: schema.users.githubId,
          set: { name: gh.name ?? gh.login, avatarUrl: gh.avatar_url },
        })
        .returning();
      const session = await app.createSession(user!.id);
      setSessionCookie(reply, session.token, session.expiresAt);
      return reply.redirect(config.WEB_ORIGIN);
    },
  );

  // Local development only: lets you work without registering a GitHub OAuth app.
  if (config.devLoginEnabled) {
    r.post(
      '/auth/dev-login',
      { config: authLimit, schema: { body: z.object({ name: z.string().trim().min(1).max(40) }), response: { 200: userSchema } } },
      async (req, reply) => {
        const githubId = `dev:${req.body.name.toLowerCase()}`;
        const [user] = await db
          .insert(schema.users)
          .values({ githubId, name: req.body.name })
          .onConflictDoUpdate({ target: schema.users.githubId, set: { name: req.body.name } })
          .returning();
        const session = await app.createSession(user!.id);
        setSessionCookie(reply, session.token, session.expiresAt);
        return { id: user!.id, name: user!.name, avatarUrl: user!.avatarUrl };
      },
    );
  }

  r.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  r.get('/me', { schema: { response: { 200: userSchema } } }, async (req) => {
    const user = app.requireUser(req);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    if (!row) throw notFound('User');
    return { id: row.id, name: row.name, avatarUrl: row.avatarUrl };
  });
}
