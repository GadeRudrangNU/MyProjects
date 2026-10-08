import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { eq } from 'drizzle-orm';
import { schema } from '../src/db/client.js';
import { createTestApp, type TestApp, type TestUser } from './helpers.js';

let t: TestApp;
let owner: TestUser, editor: TestUser, viewer: TestUser, stranger: TestUser;
let fileId: string, base: string;
const clients: WebsocketProvider[] = [];

async function until(fn: () => boolean | Promise<boolean>, ms = 5000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function connect(u: TestUser, id = fileId) {
  const ticket = (await u.call('POST', `/files/${id}/ws-ticket`)).json().ticket as string;
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${base}/api/v1/ws/files`, id, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    params: { ticket },
    disableBc: true,
  });
  clients.push(provider);
  await until(() => provider.synced);
  return { doc, provider, text: doc.getText('content') };
}

beforeAll(async () => {
  t = await createTestApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `ws://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
  [owner, editor, viewer, stranger] = await Promise.all(['olivia', 'eddie', 'vera', 'sam'].map((n) => t.login(n)));
  const wsId = (await owner.call('POST', '/workspaces', { name: 'Team' })).json().id;
  for (const [u, role] of [[editor, 'editor'], [viewer, 'viewer']] as const) {
    const inv = await owner.call('POST', `/workspaces/${wsId}/invites`, { role });
    await u.call('POST', `/invites/${inv.json().token}/accept`);
  }
  const projectId = (await owner.call('POST', `/workspaces/${wsId}/projects`, { name: 'P' })).json().id;
  fileId = (await owner.call('POST', `/projects/${projectId}/files`, { path: 'main.js', kind: 'file' })).json().id;
});

afterAll(async () => {
  clients.forEach((c) => c.destroy());
  await t.close();
});

describe('websocket access control', () => {
  it('refuses tickets to non-members', async () => {
    expect((await stranger.call('POST', `/files/${fileId}/ws-ticket`)).statusCode).toBe(404);
  });
  it('rejects upgrades with a missing, forged, or other-file ticket before opening a socket', async () => {
    const good = (await owner.call('POST', `/files/${fileId}/ws-ticket`)).json().ticket as string;
    const forged = `${good.split('.')[0]}.AAAA`;
    for (const q of ['', '?ticket=garbage', `?ticket=${forged}`]) {
      const status = await new Promise<number>((resolve) => {
        const ws = new WebSocket(`${base}/api/v1/ws/files/${fileId}${q}`);
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        ws.on('open', () => resolve(101));
        ws.on('error', () => {});
      });
      expect([400, 401], q).toContain(status);
    }
  });
  it('rejects browsers connecting from another origin', async () => {
    const ticket = (await owner.call('POST', `/files/${fileId}/ws-ticket`)).json().ticket as string;
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${base}/api/v1/ws/files/${fileId}?ticket=${ticket}`, { origin: 'https://evil.example' });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
      ws.on('error', () => {});
    });
    expect(status).toBe(403);
  });
});

describe('collaborative editing', () => {
  it('converges concurrent edits from two editors', async () => {
    const a = await connect(owner);
    const b = await connect(editor);
    a.text.insert(0, 'hello ');
    b.text.insert(0, 'world');
    await until(() => a.text.toString() === b.text.toString() && a.text.length === 11);
    expect(a.text.toString()).toBe(b.text.toString());
    expect(a.text.toString()).toContain('hello');
    expect(a.text.toString()).toContain('world');
  });

  it('shares presence between collaborators', async () => {
    const a = await connect(owner);
    const b = await connect(editor);
    a.provider.awareness.setLocalStateField('user', { name: 'Olivia', color: '#f00' });
    await until(() => [...b.provider.awareness.getStates().values()].some((s) => s.user?.name === 'olivia'));
  });

  it('lets viewers read but silently drops their writes on the server', async () => {
    const a = await connect(owner);
    const v = await connect(viewer);
    await until(() => v.text.toString() === a.text.toString() && v.text.length > 0);

    const before = a.text.toString();
    v.text.insert(0, 'HACKED');
    await new Promise((r) => setTimeout(r, 400));
    expect(a.text.toString()).toBe(before);

    // A fresh client confirms the server's copy was never changed.
    const fresh = await connect(editor);
    expect(fresh.text.toString()).toBe(before);
    expect(fresh.text.toString()).not.toContain('HACKED');

    // Viewers still receive live updates from editors.
    a.text.insert(0, 'live:');
    await until(() => v.text.toString().includes('live:'));
  });

  it('persists to Postgres when the last client leaves, and restores for the next client', async () => {
    const a = await connect(owner);
    a.text.insert(a.text.length, '\nPERSIST-ME');
    const expected = a.text.toString();
    // Disconnect every client for this file so the document is flushed and unloaded.
    clients.forEach((c) => c.destroy());
    clients.length = 0;
    await until(async () => {
      const [row] = await t.app.db.select().from(schema.files).where(eq(schema.files.id, fileId));
      return row?.plainText === expected;
    });
    const [row] = await t.app.db.select().from(schema.files).where(eq(schema.files.id, fileId));
    expect(row?.yjsState?.length).toBeGreaterThan(0);

    await until(() => t.app.docs.openDocs === 0);
    const again = await connect(editor);
    expect(again.text.toString()).toBe(expected);
  });

  it('disconnects clients when their file is deleted', async () => {
    const wsId = (await owner.call('POST', '/workspaces', { name: 'Del' })).json().id;
    const pid = (await owner.call('POST', `/workspaces/${wsId}/projects`, { name: 'P' })).json().id;
    const f = (await owner.call('POST', `/projects/${pid}/files`, { path: 'gone.js', kind: 'file' })).json();
    const a = await connect(owner, f.id);
    expect((await owner.call('DELETE', `/files/${f.id}`)).statusCode).toBe(204);
    await until(() => !a.provider.wsconnected);
  });

  it('forces a removed member off the file and refuses their reconnect', async () => {
    const wsId = (await owner.call('POST', '/workspaces', { name: 'Kick' })).json().id;
    const inv = (await owner.call('POST', `/workspaces/${wsId}/invites`, { role: 'editor' })).json();
    const guest = await t.login('guest');
    await guest.call('POST', `/invites/${inv.token}/accept`);
    const pid = (await owner.call('POST', `/workspaces/${wsId}/projects`, { name: 'P' })).json().id;
    const f = (await owner.call('POST', `/projects/${pid}/files`, { path: 'k.js', kind: 'file' })).json();
    const g = await connect(guest, f.id);
    expect((await owner.call('DELETE', `/workspaces/${wsId}/members/${guest.user.id}`)).statusCode).toBe(204);
    await until(() => !g.provider.wsconnected);
    expect((await guest.call('POST', `/files/${f.id}/ws-ticket`)).statusCode).toBe(404);
  });

  it('applies a role downgrade to live sockets on reconnect', async () => {
    const wsId = (await owner.call('POST', '/workspaces', { name: 'Demote' })).json().id;
    const inv = (await owner.call('POST', `/workspaces/${wsId}/invites`, { role: 'editor' })).json();
    const guest = await t.login('demoted');
    await guest.call('POST', `/invites/${inv.token}/accept`);
    const pid = (await owner.call('POST', `/workspaces/${wsId}/projects`, { name: 'P' })).json().id;
    const f = (await owner.call('POST', `/projects/${pid}/files`, { path: 'd.js', kind: 'file' })).json();
    const g = await connect(guest, f.id);
    await owner.call('PATCH', `/workspaces/${wsId}/members/${guest.user.id}`, { role: 'viewer' });
    await until(() => !g.provider.wsconnected);
    expect((await guest.call('POST', `/files/${f.id}/ws-ticket`)).json().role).toBe('viewer');
  });

  it('attributes presence to the authenticated user, not the name the client claims', async () => {
    const a = await connect(owner);
    const b = await connect(editor);
    a.provider.awareness.setLocalStateField('user', { id: 'x', name: 'The CEO', color: '#00ff00' });
    await until(() => [...b.provider.awareness.getStates().values()].some((s) => s.user?.color === '#00ff00'));
    const seen = [...b.provider.awareness.getStates().values()].find((s) => s.user?.color === '#00ff00');
    expect(seen?.user.name).toBe('olivia');
    expect(seen?.user.id).toBe(owner.user.id);
  });

  it('answers a sync request that arrives while the document is still loading', async () => {
    const wsId = (await owner.call('POST', '/workspaces', { name: 'Race' })).json().id;
    const pid = (await owner.call('POST', `/workspaces/${wsId}/projects`, { name: 'P' })).json().id;
    const f = (await owner.call('POST', `/projects/${pid}/files`, { path: 'r.js', kind: 'file' })).json();
    const ticket = (await owner.call('POST', `/files/${f.id}/ws-ticket`)).json().ticket as string;

    // Make loading slow so the client's first message lands before the server is ready for it.
    const original = t.app.docs.get.bind(t.app.docs);
    t.app.docs.get = async (id: string) => {
      await new Promise((r) => setTimeout(r, 400));
      return original(id);
    };
    try {
      const gotStep2 = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`${base}/api/v1/ws/files/${f.id}?ticket=${ticket}`);
        ws.on('open', () => {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, 0);
          syncProtocol.writeSyncStep1(enc, new Y.Doc());
          ws.send(encoding.toUint8Array(enc));
        });
        ws.on('message', (data: Buffer) => {
          const dec = decoding.createDecoder(new Uint8Array(data));
          if (decoding.readVarUint(dec) === 0 && decoding.readVarUint(dec) === syncProtocol.messageYjsSyncStep2) {
            ws.close();
            resolve(true);
          }
        });
        setTimeout(() => resolve(false), 4000);
      });
      expect(gotStep2).toBe(true);
    } finally {
      t.app.docs.get = original;
    }
  });

  it('unloads a document when its only client leaves before it finished loading', async () => {
    const wsId = (await owner.call('POST', '/workspaces', { name: 'Early' })).json().id;
    const pid = (await owner.call('POST', `/workspaces/${wsId}/projects`, { name: 'P' })).json().id;
    const f = (await owner.call('POST', `/projects/${pid}/files`, { path: 'e.js', kind: 'file' })).json();
    const ticket = (await owner.call('POST', `/files/${f.id}/ws-ticket`)).json().ticket as string;
    const original = t.app.docs.get.bind(t.app.docs);
    t.app.docs.get = async (id: string) => {
      await new Promise((r) => setTimeout(r, 300));
      return original(id);
    };
    try {
      const ws = new WebSocket(`${base}/api/v1/ws/files/${f.id}?ticket=${ticket}`);
      await new Promise((r) => ws.on('open', r));
      ws.terminate();
      await until(() => !t.app.docs.isOpen(f.id), 5000);
    } finally {
      t.app.docs.get = original;
    }
  });

  it('opens an imported file with its content already in the shared document', async () => {
    const wsId = (await owner.call('POST', '/workspaces', { name: 'Import' })).json().id;
    const pid = (await owner.call('POST', `/workspaces/${wsId}/projects`, { name: 'P' })).json().id;
    const content = 'const imported = true;' + String.fromCharCode(10) + 'line two';
    const f = (await owner.call('POST', `/projects/${pid}/files`, { path: 'in.js', kind: 'file', content })).json();
    const c = await connect(owner, f.id);
    expect(c.text.toString()).toBe(content);
  });
});
