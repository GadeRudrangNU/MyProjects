import { z } from 'zod';
import { ROLES } from './permissions.js';

export const roleSchema = z.enum(ROLES);
/** Roles that can be handed out. Ownership is never granted through invites or role changes. */
export const assignableRoleSchema = z.enum(['editor', 'viewer']);

export const idSchema = z.string().uuid();

export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof errorSchema>;

export const userSchema = z.object({
  id: idSchema,
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

export const workspaceSchema = z.object({
  id: idSchema,
  name: z.string(),
  ownerId: idSchema,
  createdAt: z.string(),
  role: roleSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const createWorkspaceSchema = z.object({ name: z.string().trim().min(1).max(60) });
export const updateWorkspaceSchema = createWorkspaceSchema;

export const memberSchema = z.object({
  user: userSchema,
  role: roleSchema,
});
export type Member = z.infer<typeof memberSchema>;

export const updateMemberSchema = z.object({ role: assignableRoleSchema });

export const createInviteSchema = z.object({
  role: assignableRoleSchema,
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
  maxUses: z.number().int().min(1).max(100).default(10),
});

export const inviteSchema = z.object({
  id: idSchema,
  role: assignableRoleSchema,
  expiresAt: z.string(),
  maxUses: z.number().int(),
  useCount: z.number().int(),
});

export const createdInviteSchema = inviteSchema.extend({
  /** Returned exactly once; only a hash is stored. */
  token: z.string(),
});

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function page<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
