import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestUser } from './helpers.js';

let t: TestApp;
let owner: TestUser, editor: TestUser, viewer: TestUser, stranger: TestUser;
let wsId: string, projectId: string;

beforeAll(async () => {
  t = await createTestApp();
  [owner, editor, viewer, stranger] = await Promise.all(['olivia', 'eddie', 'vera', 'sam'].map((n) => t.login(n)));
  wsId = (await owner.call('POST', '/workspaces', { name: 'Team' })).json().id;
  for (const [u, role] of [[editor, 'editor'], [viewer, 'viewer']] as const) {
    const inv = await owner.call('POST', `/workspaces/${wsId}/invites`, { role });
    await u.call('POST', `/invites/${inv.json().token}/accept`);
  }
  projectId = (await editor.call('POST', `/workspaces/${wsId}/projects`, { name: 'App' })).json().id;
});
afterAll(() => t.close());

const paths = async (u: TestUser) =>
  (await u.call('GET', `/projects/${projectId}/files`)).json().items.map((f: { path: string }) => f.path);

describe('projects', () => {
  it('lets editors create, viewers list, and strangers see nothing', async () => {
    expect((await viewer.call('POST', `/workspaces/${wsId}/projects`, { name: 'Nope' })).statusCode).toBe(403);
    expect((await viewer.call('GET', `/workspaces/${wsId}/projects`)).json().items).toHaveLength(1);
    expect((await stranger.call('GET', `/workspaces/${wsId}/projects`)).statusCode).toBe(404);
    expect((await stranger.call('GET', `/projects/${projectId}`)).statusCode).toBe(404);
  });
  it('lets only the owner delete a project', async () => {
    const p = (await editor.call('POST', `/workspaces/${wsId}/projects`, { name: 'Temp' })).json();
    expect((await editor.call('DELETE', `/projects/${p.id}`)).statusCode).toBe(403);
    expect((await owner.call('DELETE', `/projects/${p.id}`)).statusCode).toBe(204);
  });
});

describe('file tree', () => {
  it('creates folders and files, requiring an existing parent', async () => {
    expect((await editor.call('POST', `/projects/${projectId}/files`, { path: 'src', kind: 'folder' })).statusCode).toBe(201);
    expect((await editor.call('POST', `/projects/${projectId}/files`, { path: 'src/index.js', kind: 'file' })).statusCode).toBe(201);
    const orphan = await editor.call('POST', `/projects/${projectId}/files`, { path: 'nope/a.js', kind: 'file' });
    expect(orphan.statusCode).toBe(400);
  });
  it('rejects duplicates and unsafe paths', async () => {
    const dup = await editor.call('POST', `/projects/${projectId}/files`, { path: 'src', kind: 'folder' });
    expect(dup.statusCode).toBe(409);
    for (const bad of ['../etc/passwd', '/abs', 'a//b', 'a/./b', 'a/..', ' lead', 'x'.repeat(301)]) {
      const res = await editor.call('POST', `/projects/${projectId}/files`, { path: bad, kind: 'file' });
      expect(res.statusCode, bad).toBe(400);
    }
  });
  it('forbids viewers and strangers from changing the tree', async () => {
    expect((await viewer.call('POST', `/projects/${projectId}/files`, { path: 'v.js', kind: 'file' })).statusCode).toBe(403);
    expect((await stranger.call('POST', `/projects/${projectId}/files`, { path: 's.js', kind: 'file' })).statusCode).toBe(404);
    expect(await paths(viewer)).toEqual(['src', 'src/index.js']);
  });
  it('moves a folder together with its contents', async () => {
    await editor.call('POST', `/projects/${projectId}/files`, { path: 'src/lib', kind: 'folder' });
    await editor.call('POST', `/projects/${projectId}/files`, { path: 'src/lib/util.js', kind: 'file' });
    await editor.call('POST', `/projects/${projectId}/files`, { path: 'srcx.js', kind: 'file' });
    const src = (await editor.call('GET', `/projects/${projectId}/files`)).json().items.find((f: { path: string }) => f.path === 'src');
    expect((await editor.call('PATCH', `/files/${src.id}`, { path: 'app' })).json().path).toBe('app');
    // A sibling that merely shares the prefix must not move.
    expect(await paths(editor)).toEqual(['app', 'app/index.js', 'app/lib', 'app/lib/util.js', 'srcx.js']);
  });
  it('refuses to move a folder into itself or onto an existing path', async () => {
    const items = (await editor.call('GET', `/projects/${projectId}/files`)).json().items as { id: string; path: string }[];
    const app = items.find((f) => f.path === 'app')!;
    expect((await editor.call('PATCH', `/files/${app.id}`, { path: 'app/lib/app' })).statusCode).toBe(400);
    expect((await editor.call('PATCH', `/files/${app.id}`, { path: 'srcx.js' })).statusCode).toBe(409);
  });
  it('deletes a folder with its contents', async () => {
    const items = (await editor.call('GET', `/projects/${projectId}/files`)).json().items as { id: string; path: string }[];
    const lib = items.find((f) => f.path === 'app/lib')!;
    expect((await editor.call('DELETE', `/files/${lib.id}`)).statusCode).toBe(204);
    expect(await paths(editor)).toEqual(['app', 'app/index.js', 'srcx.js']);
    expect((await viewer.call('DELETE', `/files/${items[0]!.id}`)).statusCode).toBe(403);
  });
});
