
export type ListJobsStatus = typeof ListJobsStatus[keyof typeof ListJobsStatus];


// eslint-disable-next-line @typescript-eslint/no-redeclare
export const ListJobsStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  DEAD: 'DEAD',
} as const;
