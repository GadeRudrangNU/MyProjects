export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  'workspace:read',
  'workspace:delete',
  'workspace:rename',
  'member:manage',
  'invite:create',
  'project:create',
  'project:delete',
  'file:read',
  'file:write',
  'comment:create',
  'code:run',
  'snapshot:create',
  'export:create',
] as const;
export type Action = (typeof ACTIONS)[number];

const VIEWER: readonly Action[] = ['workspace:read', 'file:read', 'comment:create', 'code:run'];
const EDITOR: readonly Action[] = [
  ...VIEWER,
  'project:create',
  'file:write',
  'snapshot:create',
  'export:create',
];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  viewer: new Set(VIEWER),
  editor: new Set(EDITOR),
  owner: new Set(ACTIONS),
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return role ? MATRIX[role].has(action) : false;
}
