
export type UserViewRole = typeof UserViewRole[keyof typeof UserViewRole];


// eslint-disable-next-line @typescript-eslint/no-redeclare
export const UserViewRole = {
  MEMBER: 'MEMBER',
  SUPPORT: 'SUPPORT',
  REVIEWER: 'REVIEWER',
  ADMIN: 'ADMIN',
} as const;
