
export type VerificationFormDocType = typeof VerificationFormDocType[keyof typeof VerificationFormDocType];


// eslint-disable-next-line @typescript-eslint/no-redeclare
export const VerificationFormDocType = {
  PASSPORT: 'PASSPORT',
  DRIVERS_LICENSE: 'DRIVERS_LICENSE',
  NATIONAL_ID: 'NATIONAL_ID',
} as const;
