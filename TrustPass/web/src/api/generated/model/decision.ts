import type { DecisionDecision } from './decisionDecision';

export interface Decision {
  decision: DecisionDecision;
  /**
   * @minLength 0
   * @maxLength 500
   */
  reason?: string;
}
