import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { can, idSchema, wsTicketSchema, type Role } from '@quack/shared';
import { schema } from '../db/client.js';
import { HttpError, forbidden, notFound } from '../errors.js';
import { issueTicket, verifyTicket } from './ticket.js';
import { DocManager, type Connection } from './docs.js';
import { sanitizeAwareness } from './awareness.js';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_QUERY_AWARENESS = 3;

declare module 'fastify' {
  interface FastifyInstance {
    docs: DocManager;
  }
  interface FastifyRequest {
    wsCtx?: { userId: string; userName: string; fileId: string; role: Role };
  }
}

export async function realtimeRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, config } = app;
  const { files, projects, memberships } = schema;

  /** The user's role for the workspace that owns this file, or null for non-members / unknown files. */
  async function fileRole(userId: string, fileId: string) {
    const [row] = await db
      .select({ kind: files.kind, role: memberships.role })
      .from(files)
      .innerJoin(projects, eq(projects.id, files.projectId))
      .innerJoin(memberships, and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)))
      .where(eq(files.id, fileId));
    return row ?? null;
  }

  r.post(
    '/files/:id/ws-ticket',
    { schema: { params: z.object({ id: idSchema }), response: { 200: wsTicketSchema } } },
    async (req) => {
      const user = app.requireUser(req);
      const access = await fileRole(user.id, req.params.id);
      if (!access || access.kind !== 'file') throw notFound('File');
      if (!can(access.role, 'file:read')) throw forbidden();
      return { ticket: issueTicket(config.ticketSecret, user.id, req.params.id), role: access.role };
    },
  );

  r.get(
    '/ws/files/:fileId',
    {
      websocket: true,
      schema: { params: z.object({ fileId: idSchema }), querystring: z.object({ ticket: z.string().min(1) }) },
      // Runs before the upgrade, so failures are plain HTTP 4xx and no socket is ever opened.
      preValidation: async (req) => {
        const { fileId } = req.params as { fileId: string };
        const { ticket } = req.query as { ticket?: string };
        if (req.headers.origin && req.headers.origin !== config.WEB_ORIGIN) {
          throw new HttpError(403, 'bad_origin', 'Cross-origin WebSocket blocked');
        }
        const userId = ticket ? verifyTicket(config.ticketSecret, ticket, fileId) : null;
        if (!userId) throw new HttpError(401, 'unauthorized', 'Invalid or expired ticket');
        const access = await fileRole(userId, fileId);
        if (!access || access.kind !== 'file') throw notFound('File');
        if (!can(access.role, 'file:read')) throw forbidden();
        const [u] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId));
        req.wsCtx = { userId, userName: u?.name ?? 'Unknown', fileId, role: access.role };
      },
    },
    async (socket, req) => {
      const { userId, userName, fileId, role } = req.wsCtx!;
      // The client speaks first. Listeners must exist before the first await, otherwise its opening
      // sync request is dropped while the document loads and it waits for a reply that never comes.
      const early: Array<[Buffer, boolean]> = [];
      let onMessage: ((data: Buffer, isBinary: boolean) => void) | null = null;
      let onClose: (() => void) | null = null;
      let closedEarly = false;
      socket.on('message', (data: Buffer, isBinary: boolean) => (onMessage ? onMessage(data, isBinary) : early.push([data, isBinary])));
      socket.on('close', () => (onClose ? onClose() : (closedEarly = true)));

      const live = await app.docs.get(fileId);
      const conn: Connection = {
        userId,
        userName,
        readOnly: !can(role, 'file:write'),
        awarenessIds: new Set(),
        send: (data) => {
          if (socket.readyState === socket.OPEN) socket.send(data);
        },
        close: (code, reason) => socket.close(code, reason),
      };
      const log = req.log.child({ fileId, userId, role });
      if (closedEarly) {
        void live.remove(conn); // nobody else may be holding the document open: let it unload
        return;
      }
      log.info('ws connected');
      live.add(conn);

      const onDocUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin === conn) return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.writeUpdate(enc, update);
        conn.send(encoding.toUint8Array(enc));
      };
      const onAwareness = (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        if (origin === conn) {
          added.forEach((id) => conn.awarenessIds.add(id));
          removed.forEach((id) => conn.awarenessIds.delete(id));
        }
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(live.awareness, [...added, ...updated, ...removed]));
        conn.send(encoding.toUint8Array(enc));
      };
      live.doc.on('update', onDocUpdate);
      live.awareness.on('update', onAwareness);

      // Open the handshake: ask for the client's state and offer our awareness snapshot.
      {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.writeSyncStep1(enc, live.doc);
        conn.send(encoding.toUint8Array(enc));
        const states = [...live.awareness.getStates().keys()];
        if (states.length) {
          const aw = encoding.createEncoder();
          encoding.writeVarUint(aw, MSG_AWARENESS);
          encoding.writeVarUint8Array(aw, encodeAwarenessUpdate(live.awareness, states));
          conn.send(encoding.toUint8Array(aw));
        }
      }

      onMessage = (data, isBinary) => {
        if (!isBinary) return;
        try {
          const dec = decoding.createDecoder(new Uint8Array(data));
          const type = decoding.readVarUint(dec);
          if (type === MSG_SYNC) {
            const reply = encoding.createEncoder();
            encoding.writeVarUint(reply, MSG_SYNC);
            const syncType = decoding.readVarUint(dec);
            if (syncType === syncProtocol.messageYjsSyncStep1) {
              syncProtocol.readSyncStep1(dec, reply, live.doc);
            } else if (conn.readOnly || live.frozen) {
              // Enforced here, on the server: viewers (and over-limit documents) never get to write.
              log.warn({ readOnly: conn.readOnly, frozen: live.frozen }, 'dropped update');
              return;
            } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
              syncProtocol.readUpdate(dec, live.doc, conn);
            }
            if (encoding.length(reply) > 1) conn.send(encoding.toUint8Array(reply));
          } else if (type === MSG_AWARENESS) {
            const clean = sanitizeAwareness(decoding.readVarUint8Array(dec), conn);
            if (clean) applyAwarenessUpdate(live.awareness, clean, conn);
          } else if (type === MSG_QUERY_AWARENESS) {
            const enc = encoding.createEncoder();
            encoding.writeVarUint(enc, MSG_AWARENESS);
            encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(live.awareness, [...live.awareness.getStates().keys()]));
            conn.send(encoding.toUint8Array(enc));
          }
        } catch (err) {
          log.warn({ err }, 'bad websocket message');
          socket.close(1003, 'bad message');
        }
      };
      for (const [data, isBinary] of early.splice(0)) onMessage(data, isBinary);

      onClose = () => {
        live.doc.off('update', onDocUpdate);
        live.awareness.off('update', onAwareness);
        log.info('ws disconnected');
        void live.remove(conn);
      };
    },
  );
}
