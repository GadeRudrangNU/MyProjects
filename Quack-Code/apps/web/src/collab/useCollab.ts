import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { Awareness } from 'y-protocols/awareness';
import type { Role, User } from '@quack/shared';
import { api, ApiError, wsBase } from '../lib/api';

export type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'denied';

export interface Peer {
  userId: string;
  name: string;
  color: string;
}

export interface Collab {
  ytext: Y.Text;
  awareness: Awareness;
  undoManager: Y.UndoManager;
  role: Role | null;
  status: ConnStatus;
  peers: Peer[];
  announcement: string;
}

const COLORS = ['#f5c542', '#7dd3fc', '#86efac', '#fca5a5', '#c4b5fd', '#fdba74', '#f9a8d4', '#5eead4'];
export const colorFor = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
};

interface Live {
  doc: Y.Doc;
  provider: WebsocketProvider;
  ytext: Y.Text;
  undoManager: Y.UndoManager;
}

/**
 * One Yjs document per file. Edits land in IndexedDB first, so the editor works offline and
 * merges automatically on reconnect; the WebSocket ticket is re-fetched for every (re)connect.
 */
export function useCollab(fileId: string, me: User): Collab | null {
  const [live, setLive] = useState<Live | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let backoff = 500;
    let everConnected = false;

    const doc = new Y.Doc();
    const ytext = doc.getText('content');
    const undoManager = new Y.UndoManager(ytext);
    const idb = new IndexeddbPersistence(`quack:${fileId}`, doc);
    const params = { ticket: '' };
    const provider = new WebsocketProvider(wsBase(), fileId, doc, { connect: false, params });

    provider.awareness.setLocalStateField('user', { id: me.id, name: me.name, color: colorFor(me.id) });

    const connect = async () => {
      if (disposed) return;
      try {
        const t = await api<{ ticket: string; role: Role }>('POST', `/files/${fileId}/ws-ticket`);
        if (disposed) return;
        params.ticket = t.ticket;
        setRole(t.role);
        backoff = 500;
        provider.connect();
      } catch (e) {
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          setStatus('denied');
          return;
        }
        setStatus(navigator.onLine ? 'reconnecting' : 'offline');
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15_000);
      }
    };

    const syncStatus = () => {
      // The browser knowing it is offline beats a socket that has not noticed yet.
      if (!navigator.onLine) setStatus('offline');
      else if (provider.wsconnected && provider.synced) {
        everConnected = true;
        setStatus('connected');
      } else setStatus(everConnected ? 'reconnecting' : 'connecting');
    };

    provider.on('status', syncStatus);
    provider.on('sync', syncStatus);
    provider.on('connection-close', () => {
      // Turn y-websocket's own scheduled retry into a no-op; ours fetches a fresh ticket first.
      // (Not provider.disconnect(): it closes the socket again, re-emitting this event forever.)
      provider.shouldConnect = false;
      syncStatus();
      clearTimeout(retry);
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 15_000);
    });

    const onOnline = () => {
      clearTimeout(retry);
      backoff = 500;
      if (!provider.wsconnected) void connect();
    };
    const onOffline = () => {
      syncStatus();
      // A dead connection can look alive for minutes; closing it starts the reconnect loop right away.
      provider.ws?.close();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    let known = new Map<string, string>();
    const onAwareness = () => {
      const byUser = new Map<string, Peer>();
      provider.awareness.getStates().forEach((s, clientId) => {
        const u = s.user as { id?: string; name?: string; color?: string } | undefined;
        if (clientId === doc.clientID || !u?.id || !u.name || u.id === me.id) return;
        byUser.set(u.id, { userId: u.id, name: String(u.name).slice(0, 40), color: u.color ?? '#ccc' });
      });
      const next = [...byUser.values()];
      const names = new Map(next.map((p) => [p.userId, p.name]));
      const joined = next.filter((p) => !known.has(p.userId)).map((p) => p.name);
      const left = [...known].filter(([id]) => !names.has(id)).map(([, n]) => n);
      known = names;
      setPeers(next);
      const msg = [...joined.map((n) => `${n} joined`), ...left.map((n) => `${n} left`)].join('. ');
      if (msg) setAnnouncement(msg);
    };
    provider.awareness.on('change', onAwareness);

    void idb.whenSynced.then(() => {
      if (disposed) return;
      setLive({ doc, provider, ytext, undoManager });
      void connect();
    });

    return () => {
      disposed = true;
      clearTimeout(retry);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      provider.awareness.off('change', onAwareness);
      provider.destroy();
      void idb.destroy();
      undoManager.destroy();
      doc.destroy();
      setLive(null);
      setPeers([]);
      setStatus('connecting');
    };
  }, [fileId, me.id, me.name]);

  if (!live) return null;
  return { ytext: live.ytext, awareness: live.provider.awareness, undoManager: live.undoManager, role, status, peers, announcement };
}
