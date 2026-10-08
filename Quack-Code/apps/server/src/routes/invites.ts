import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createInviteSchema, createdInviteSchema, idSchema, workspaceSchema } from '@quack/shared';
import { schema } from '../db/client.js';
import { randomToken, sha256 } from '../crypto.js';
import { HttpError } from '../errors.js';

const inviteLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

export async function inviteRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db } = app;
  const { invites, memberships, workspaces } = schema;

  r.post(
    '/workspaces/:id/invites',
    {
      config: inviteLimit,
      schema: { params: z.object({ id: idSchema }), body: createInviteSchema, response: { 201: createdInviteSchema } },
    },
    async (req, reply) => {
      await app.requireRole(req, req.params.id, 'invite:create');
      const user = app.requireUser(req);
      const token = randomToken();
      const expiresAt = new Date(Date.now() + req.body.expiresInHours * 3_600_000);
      const [inv] = await db
        .insert(invites)
        .values({
          workspaceId: req.params.id,
          tokenHash: sha256(token),
          role: req.body.role,
          expiresAt,
          maxUses: req.body.maxUses,
          createdBy: user.id,
        })
        .returning();
      return reply.status(201).send({
        id: inv!.id,
        role: inv!.role,
        expiresAt: inv!.expiresAt.toISOString(),
        maxUses: inv!.maxUses,
        useCount: inv!.useCount,
        token,
      });
    },
  );

  r.post(
    '/invites/:token/accept',
    { config: inviteLimit, schema: { params: z.object({ token: z.string().min(10).max(200) }), response: { 200: workspaceSchema } } },
    async (req) => {
      const user = app.requireUser(req);
      const tokenHash = sha256(req.params.token);

      return db.transaction(async (tx) => {
        const [inv] = await tx.select().from(invites).where(eq(invites.tokenHash, tokenHash));
        // One generic error for unknown, expired and used-up tokens so tokens cannot be probed.
        const invalid = new HttpError(410, 'invite_invalid', 'This invite link is invalid or has expired');
        if (!inv) throw invalid;

        const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, inv.workspaceId));
        const [existing] = await tx
          .select()
          .from(memberships)
          .where(and(eq(memberships.workspaceId, inv.workspaceId), eq(memberships.userId, user.id)));
        if (existing && ws) {
          // Already a member: no use consumed, role unchanged (never downgrade an owner).
          return { id: ws.id, name: ws.name, ownerId: ws.ownerId, createdAt: ws.createdAt.toISOString(), role: existing.role };
        }

        // Atomic claim: concurrent accepts cannot exceed max_uses.
        const claimed = await tx
          .update(invites)
          .set({ useCount: sql`${invites.useCount} + 1` })
          .where(and(eq(invites.id, inv.id), gt(invites.expiresAt, new Date()), lt(invites.useCount, invites.maxUses)))
          .returning({ id: invites.id });
        if (claimed.length === 0 || !ws) throw invalid;

        await tx.insert(memberships).values({ workspaceId: ws.id, userId: user.id, role: inv.role });
        return { id: ws.id, name: ws.name, ownerId: ws.ownerId, createdAt: ws.createdAt.toISOString(), role: inv.role };
      });
    },
  );
}
