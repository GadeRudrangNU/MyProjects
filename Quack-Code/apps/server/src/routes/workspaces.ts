import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  createWorkspaceSchema,
  idSchema,
  page,
  paginationQuerySchema,
  updateWorkspaceSchema,
  workspaceSchema,
} from '@quack/shared';
import { schema } from '../db/client.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import { notFound } from '../errors.js';
import { workspaceFileIds } from '../realtime/files.js';

const idParams = z.object({ id: idSchema });

export async function workspaceRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db } = app;
  const { workspaces, memberships } = schema;

  const toDto = (w: typeof workspaces.$inferSelect, role: 'owner' | 'editor' | 'viewer') => ({
    id: w.id,
    name: w.name,
    ownerId: w.ownerId,
    createdAt: w.createdAt.toISOString(),
    role,
  });

  r.get(
    '/workspaces',
    { schema: { querystring: paginationQuerySchema, response: { 200: page(workspaceSchema) } } },
    async (req) => {
      const user = app.requireUser(req);
      const { limit } = req.query;
      const cursor = decodeCursor(req.query.cursor);
      const after = cursor
        ? or(
            lt(workspaces.createdAt, new Date(cursor.t)),
            and(eq(workspaces.createdAt, new Date(cursor.t)), lt(workspaces.id, cursor.id)),
          )
        : undefined;
      const rows = await db
        .select({ w: workspaces, role: memberships.role })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .where(and(eq(memberships.userId, user.id), after))
        .orderBy(desc(workspaces.createdAt), desc(workspaces.id))
        .limit(limit + 1);
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        items: items.map((x) => toDto(x.w, x.role)),
        nextCursor: rows.length > limit && last ? encodeCursor({ t: last.w.createdAt.toISOString(), id: last.w.id }) : null,
      };
    },
  );

  r.post(
    '/workspaces',
    { schema: { body: createWorkspaceSchema, response: { 201: workspaceSchema } } },
    async (req, reply) => {
      const user = app.requireUser(req);
      const w = await db.transaction(async (tx) => {
        const [created] = await tx.insert(workspaces).values({ name: req.body.name, ownerId: user.id }).returning();
        await tx.insert(memberships).values({ workspaceId: created!.id, userId: user.id, role: 'owner' });
        return created!;
      });
      return reply.status(201).send(toDto(w, 'owner'));
    },
  );

  r.get('/workspaces/:id', { schema: { params: idParams, response: { 200: workspaceSchema } } }, async (req) => {
    const role = await app.requireRole(req, req.params.id, 'workspace:read');
    const [w] = await db.select().from(workspaces).where(eq(workspaces.id, req.params.id));
    if (!w) throw notFound('Workspace');
    return toDto(w, role);
  });

  r.patch(
    '/workspaces/:id',
    { schema: { params: idParams, body: updateWorkspaceSchema, response: { 200: workspaceSchema } } },
    async (req) => {
      const role = await app.requireRole(req, req.params.id, 'workspace:rename');
      const [w] = await db
        .update(workspaces)
        .set({ name: req.body.name })
        .where(eq(workspaces.id, req.params.id))
        .returning();
      if (!w) throw notFound('Workspace');
      return toDto(w, role);
    },
  );

  r.delete('/workspaces/:id', { schema: { params: idParams } }, async (req, reply) => {
    await app.requireRole(req, req.params.id, 'workspace:delete');
    const fileIds = await workspaceFileIds(db, req.params.id);
    await db.delete(workspaces).where(eq(workspaces.id, req.params.id));
    await app.docs.evict(fileIds);
    return reply.status(204).send();
  });
}
