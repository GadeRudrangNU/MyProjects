
export type MemberViewDocType = typeof MemberViewDocType[keyof typeof MemberViewDocType];


// eslint-disable-next-line @typescript-eslint/no-redeclare
export const MemberViewDocType = {
  PASSPORT: 'PASSPORT',
  DRIVERS_LICENSE: 'DRIVERS_LICENSE',
  NATIONAL_ID: 'NATIONAL_ID',
} as const;
