
export type ReviewItemDocType = typeof ReviewItemDocType[keyof typeof ReviewItemDocType];


// eslint-disable-next-line @typescript-eslint/no-redeclare
export const ReviewItemDocType = {
  PASSPORT: 'PASSPORT',
  DRIVERS_LICENSE: 'DRIVERS_LICENSE',
  NATIONAL_ID: 'NATIONAL_ID',
} as const;
