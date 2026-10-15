
export type DecisionDecision = typeof DecisionDecision[keyof typeof DecisionDecision];


// eslint-disable-next-line @typescript-eslint/no-redeclare
export const DecisionDecision = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
} as const;
