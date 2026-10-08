import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ORIGIN, type TestApp, type TestUser } from './helpers.js';

let t: TestApp;
let owner: TestUser, editor: TestUser, viewer: TestUser, stranger: TestUser;
let wsId: string;

beforeAll(async () => {
  t = await createTestApp();
  [owner, editor, viewer, stranger] = await Promise.all(['olivia', 'eddie', 'vera', 'sam'].map((n) => t.login(n)));
  const ws = await owner.call('POST', '/workspaces', { name: 'Team' });
  wsId = ws.json().id;
  for (const [u, role] of [[editor, 'editor'], [viewer, 'viewer']] as const) {
    const inv = await owner.call('POST', `/workspaces/${wsId}/invites`, { role });
    expect((await u.call('POST', `/invites/${inv.json().token}/accept`)).statusCode).toBe(200);
  }
});
afterAll(() => t.close());

describe('health', () => {
  it('reports alive and ready', async () => {
    expect((await t.app.inject({ url: '/healthz' })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/readyz' })).statusCode).toBe(200);
  });
});

describe('auth', () => {
  it('rejects unauthenticated requests with the standard error shape', async () => {
    const res = await t.app.inject({ url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'unauthorized', message: expect.any(String) });
  });
  it('returns the current user and lets them log out', async () => {
    expect((await owner.call('GET', '/me')).json().name).toBe('olivia');
    const temp = await t.login('temp');
    expect((await temp.call('POST', '/auth/logout')).statusCode).toBe(204);
    expect((await temp.call('GET', '/me')).statusCode).toBe(401);
  });
  it('blocks state-changing requests from another origin', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { name: 'x' },
      cookies: { quack_sid: owner.cookie },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('bad_origin');
    expect(ORIGIN).not.toBe('https://evil.example');
  });
});

describe('workspaces', () => {
  it('validates input', async () => {
    const res = await owner.call('POST', '/workspaces', { name: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_error');
  });
  it('lists only the workspaces a user belongs to, with cursor pagination', async () => {
    for (const n of ['A', 'B', 'C']) await owner.call('POST', '/workspaces', { name: n });
    const first = (await owner.call('GET', '/workspaces?limit=2')).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await owner.call('GET', `/workspaces?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second.items.length).toBeGreaterThan(0);
    const ids = new Set([...first.items, ...second.items].map((w: { id: string }) => w.id));
    expect(ids.size).toBe(first.items.length + second.items.length);
    expect((await stranger.call('GET', '/workspaces')).json().items).toHaveLength(0);
  });
  it('hides workspaces from non-members (404) and forbids non-owners from deleting (403)', async () => {
    expect((await stranger.call('GET', `/workspaces/${wsId}`)).statusCode).toBe(404);
    expect((await editor.call('DELETE', `/workspaces/${wsId}`)).statusCode).toBe(403);
    expect((await viewer.call('PATCH', `/workspaces/${wsId}`, { name: 'Hax' })).statusCode).toBe(403);
  });
  it('lets the owner rename and delete', async () => {
    const w = (await owner.call('POST', '/workspaces', { name: 'Temp' })).json();
    expect((await owner.call('PATCH', `/workspaces/${w.id}`, { name: 'Renamed' })).json().name).toBe('Renamed');
    expect((await owner.call('DELETE', `/workspaces/${w.id}`)).statusCode).toBe(204);
    expect((await owner.call('GET', `/workspaces/${w.id}`)).statusCode).toBe(404);
  });
});

describe('members', () => {
  it('lists members with roles to any member', async () => {
    const res = await viewer.call('GET', `/workspaces/${wsId}/members`);
    expect(res.json().items.map((m: { role: string }) => m.role).sort()).toEqual(['editor', 'owner', 'viewer']);
  });
  it('only the owner can change roles, and ownership cannot be reassigned', async () => {
    expect((await editor.call('PATCH', `/workspaces/${wsId}/members/${viewer.user.id}`, { role: 'editor' })).statusCode).toBe(403);
    expect((await owner.call('PATCH', `/workspaces/${wsId}/members/${owner.user.id}`, { role: 'viewer' })).statusCode).toBe(403);
    expect((await owner.call('PATCH', `/workspaces/${wsId}/members/${viewer.user.id}`, { role: 'owner' })).statusCode).toBe(400);
    const ok = await owner.call('PATCH', `/workspaces/${wsId}/members/${viewer.user.id}`, { role: 'editor' });
    expect(ok.json().role).toBe('editor');
    await owner.call('PATCH', `/workspaces/${wsId}/members/${viewer.user.id}`, { role: 'viewer' });
  });
  it('lets a member leave but not remove others; the owner cannot be removed', async () => {
    expect((await editor.call('DELETE', `/workspaces/${wsId}/members/${viewer.user.id}`)).statusCode).toBe(403);
    expect((await owner.call('DELETE', `/workspaces/${wsId}/members/${owner.user.id}`)).statusCode).toBe(403);
    const leaver = await t.login('leaver');
    const inv = (await owner.call('POST', `/workspaces/${wsId}/invites`, { role: 'viewer' })).json();
    await leaver.call('POST', `/invites/${inv.token}/accept`);
    expect((await leaver.call('DELETE', `/workspaces/${wsId}/members/${leaver.user.id}`)).statusCode).toBe(204);
    expect((await leaver.call('GET', `/workspaces/${wsId}`)).statusCode).toBe(404);
  });
});

describe('invites', () => {
  it('only owners can create invites', async () => {
    expect((await editor.call('POST', `/workspaces/${wsId}/invites`, { role: 'viewer' })).statusCode).toBe(403);
  });
  it('rejects owner-role invites', async () => {
    expect((await owner.call('POST', `/workspaces/${wsId}/invites`, { role: 'owner' })).statusCode).toBe(400);
  });
  it('enforces the usage limit', async () => {
    const inv = (await owner.call('POST', `/workspaces/${wsId}/invites`, { role: 'viewer', maxUses: 1 })).json();
    const a = await t.login('first-joiner');
    const b = await t.login('second-joiner');
    expect((await a.call('POST', `/invites/${inv.token}/accept`)).json().role).toBe('viewer');
    const res = await b.call('POST', `/invites/${inv.token}/accept`);
    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe('invite_invalid');
  });
  it('does not consume a use when an existing member re-accepts, or downgrade the owner', async () => {
    const inv = (await owner.call('POST', `/workspaces/${wsId}/invites`, { role: 'viewer', maxUses: 1 })).json();
    const again = await owner.call('POST', `/invites/${inv.token}/accept`);
    expect(again.json().role).toBe('owner');
    const joiner = await t.login('late-joiner');
    expect((await joiner.call('POST', `/invites/${inv.token}/accept`)).statusCode).toBe(200);
  });
  it('rejects expired and unknown tokens identically', async () => {
    const inv = (await owner.call('POST', `/workspaces/${wsId}/invites`, { role: 'viewer', expiresInHours: 1 })).json();
    await t.app.db.execute(
      (await import('drizzle-orm')).sql`update invites set expires_at = now() - interval '1 minute' where id = ${inv.id}`,
    );
    const joiner = await t.login('expired-joiner');
    const expired = await joiner.call('POST', `/invites/${inv.token}/accept`);
    const unknown = await joiner.call('POST', '/invites/not-a-real-token-at-all/accept');
    expect(expired.statusCode).toBe(410);
    expect(unknown.json()).toEqual(expired.json());
  });
  it('requires sign-in to accept', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/invites/whatever-token-123/accept' });
    expect(res.statusCode).toBe(401);
  });
});
