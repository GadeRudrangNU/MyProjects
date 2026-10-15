
export type MemberViewStatus = typeof MemberViewStatus[keyof typeof MemberViewStatus];


// eslint-disable-next-line @typescript-eslint/no-redeclare
export const MemberViewStatus = {
  PENDING: 'PENDING',
  IN_REVIEW: 'IN_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
