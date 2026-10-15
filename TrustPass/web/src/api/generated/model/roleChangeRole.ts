
export type RoleChangeRole = typeof RoleChangeRole[keyof typeof RoleChangeRole];


// eslint-disable-next-line @typescript-eslint/no-redeclare
export const RoleChangeRole = {
  MEMBER: 'MEMBER',
  SUPPORT: 'SUPPORT',
  REVIEWER: 'REVIEWER',
  ADMIN: 'ADMIN',
} as const;
