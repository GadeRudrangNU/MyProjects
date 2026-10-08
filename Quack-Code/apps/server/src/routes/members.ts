import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { idSchema, memberSchema, updateMemberSchema } from '@quack/shared';
import { schema } from '../db/client.js';
import { workspaceFileIds } from '../realtime/files.js';
import { forbidden, notFound } from '../errors.js';

const params = z.object({ id: idSchema, userId: idSchema });

export async function memberRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db } = app;
  const { memberships, users } = schema;

  r.get(
    '/workspaces/:id/members',
    { schema: { params: z.object({ id: idSchema }), response: { 200: z.object({ items: z.array(memberSchema) }) } } },
    async (req) => {
      await app.requireRole(req, req.params.id, 'workspace:read');
      const rows = await db
        .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, role: memberships.role })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.workspaceId, req.params.id))
        .orderBy(users.name);
      return {
        items: rows.map((m) => ({ user: { id: m.id, name: m.name, avatarUrl: m.avatarUrl }, role: m.role })),
      };
    },
  );

  r.patch(
    '/workspaces/:id/members/:userId',
    { schema: { params, body: updateMemberSchema, response: { 200: memberSchema } } },
    async (req) => {
      await app.requireRole(req, req.params.id, 'member:manage');
      const [target] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.workspaceId, req.params.id), eq(memberships.userId, req.params.userId)));
      if (!target) throw notFound('Member');
      if (target.role === 'owner') throw forbidden('The owner role cannot be changed');
      await db
        .update(memberships)
        .set({ role: req.body.role })
        .where(and(eq(memberships.workspaceId, req.params.id), eq(memberships.userId, req.params.userId)));
      // Their sockets were authorised under the old role; force a reconnect under the new one.
      await app.docs.disconnectUser(req.params.userId, await workspaceFileIds(db, req.params.id), 4001, 'role changed');
      const [u] = await db.select().from(users).where(eq(users.id, req.params.userId));
      return { user: { id: u!.id, name: u!.name, avatarUrl: u!.avatarUrl }, role: req.body.role };
    },
  );

  // Owners remove anyone but themselves; any non-owner member may remove themselves (leave).
  r.delete('/workspaces/:id/members/:userId', { schema: { params } }, async (req, reply) => {
    const me = app.requireUser(req);
    const leaving = me.id === req.params.userId;
    await app.requireRole(req, req.params.id, leaving ? 'workspace:read' : 'member:manage');
    const [target] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, req.params.id), eq(memberships.userId, req.params.userId)));
    if (!target) throw notFound('Member');
    if (target.role === 'owner') throw forbidden('The owner cannot be removed; delete the workspace instead');
    await db
      .delete(memberships)
      .where(and(eq(memberships.workspaceId, req.params.id), eq(memberships.userId, req.params.userId)));
    await app.docs.disconnectUser(req.params.userId, await workspaceFileIds(db, req.params.id), 4403, 'removed');
    return reply.status(204).send();
  });
}
