
export type ListVerificationQueueStatus = typeof ListVerificationQueueStatus[keyof typeof ListVerificationQueueStatus];


// eslint-disable-next-line @typescript-eslint/no-redeclare
export const ListVerificationQueueStatus = {
  PENDING: 'PENDING',
  IN_REVIEW: 'IN_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
