import * as Y from 'yjs';
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { MAX_DOC_CHARS } from '@quack/shared';
import { schema, type Db } from '../db/client.js';

export const TEXT_KEY = 'content';
const SAVE_DEBOUNCE_MS = 2_000;
const SAVE_MAX_WAIT_MS = 10_000;

export interface Connection {
  send(data: Uint8Array): void;
  close(code: number, reason: string): void;
  readOnly: boolean;
  userId: string;
  userName: string;
  /** Awareness client ids this socket has announced; removed when it disconnects. */
  awarenessIds: Set<number>;
}

export class LiveDoc {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  readonly conns = new Set<Connection>();
  private saveTimer: NodeJS.Timeout | null = null;
  private firstDirtyAt = 0;
  private dirty = false;
  private saving: Promise<void> = Promise.resolve();
  /** Set once the document passes MAX_DOC_CHARS: it stays readable but rejects further edits. */
  frozen = false;

  constructor(
    readonly fileId: string,
    private db: Db,
    private log: FastifyBaseLogger,
    private onEmpty: (id: string) => void,
  ) {
    this.awareness.setLocalState(null);
    this.doc.on('update', () => {
      this.dirty = true;
      if (this.doc.getText(TEXT_KEY).length > MAX_DOC_CHARS) this.frozen = true;
      this.scheduleSave();
    });
  }

  async load() {
    const [row] = await this.db
      .select({ state: schema.files.yjsState, text: schema.files.plainText })
      .from(schema.files)
      .where(eq(schema.files.id, this.fileId));
    if (row?.state) Y.applyUpdate(this.doc, new Uint8Array(row.state));
    else if (row?.text) this.doc.getText(TEXT_KEY).insert(0, row.text);
    this.dirty = false;
  }

  private scheduleSave() {
    const now = Date.now();
    if (!this.firstDirtyAt) this.firstDirtyAt = now;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const wait = Math.min(SAVE_DEBOUNCE_MS, Math.max(0, this.firstDirtyAt + SAVE_MAX_WAIT_MS - now));
    this.saveTimer = setTimeout(() => void this.flush(), wait);
  }

  /** Writes pending state to Postgres. Safe to call repeatedly; saves are serialised. */
  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.firstDirtyAt = 0;
    this.saving = this.saving.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      try {
        await this.db
          .update(schema.files)
          .set({
            yjsState: Buffer.from(Y.encodeStateAsUpdate(this.doc)),
            plainText: this.doc.getText(TEXT_KEY).toString(),
            updatedAt: new Date(),
          })
          .where(eq(schema.files.id, this.fileId));
      } catch (err) {
        this.dirty = true;
        this.log.error({ err, fileId: this.fileId }, 'failed to save document');
        this.scheduleSave();
      }
    });
    return this.saving;
  }

  add(conn: Connection) {
    this.conns.add(conn);
  }

  async remove(conn: Connection) {
    this.conns.delete(conn);
    removeAwarenessStates(this.awareness, [...conn.awarenessIds], null);
    if (this.conns.size === 0) {
      await this.flush();
      this.onEmpty(this.fileId);
    }
  }

  async destroy() {
    await this.flush();
    this.awareness.destroy();
    this.doc.destroy();
  }
}

/** One in-memory Y.Doc per open file. Nothing here is the source of truth: Postgres is. */
export class DocManager {
  private docs = new Map<string, Promise<LiveDoc>>();

  constructor(
    private db: Db,
    private log: FastifyBaseLogger,
  ) {}

  get(fileId: string): Promise<LiveDoc> {
    let p = this.docs.get(fileId);
    if (!p) {
      p = (async () => {
        const live = new LiveDoc(fileId, this.db, this.log, (id) => {
          this.docs.delete(id);
          void live.destroy();
        });
        await live.load();
        return live;
      })();
      this.docs.set(fileId, p);
      p.catch(() => this.docs.delete(fileId));
    }
    return p;
  }

  /** Disconnects everyone from the given files (e.g. after a delete) without saving over a removed row. */
  async evict(fileIds: string[]) {
    for (const id of fileIds) {
      const p = this.docs.get(id);
      if (!p) continue;
      this.docs.delete(id);
      const live = await p;
      for (const c of live.conns) c.close(4404, 'file deleted');
      live.awareness.destroy();
      live.doc.destroy();
    }
  }

  /** Closes a user's sockets on the given files; clients reconnect and are re-authorised from scratch. */
  async disconnectUser(userId: string, fileIds: string[], code: number, reason: string) {
    for (const id of fileIds) {
      const p = this.docs.get(id);
      if (!p) continue;
      const live = await p;
      for (const c of live.conns) if (c.userId === userId) c.close(code, reason);
    }
  }

  async flushAll() {
    await Promise.all([...this.docs.values()].map(async (p) => (await p).flush()));
  }

  get openDocs() {
    return this.docs.size;
  }
}
