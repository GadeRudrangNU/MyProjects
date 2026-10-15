
export type ReviewItemStatus = typeof ReviewItemStatus[keyof typeof ReviewItemStatus];


// eslint-disable-next-line @typescript-eslint/no-redeclare
export const ReviewItemStatus = {
  PENDING: 'PENDING',
  IN_REVIEW: 'IN_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
