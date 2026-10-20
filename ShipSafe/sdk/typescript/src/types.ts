export type ConditionOperator = "in" | "notIn";

export interface Condition {
  attribute: string;
  operator: ConditionOperator;
  values: string[];
}

export interface GuardSettings {
  enabled: boolean;
  mode: "auto" | "approval";
  minSamples: number;
  alpha: number;
  minDifference: number;
  windowSeconds: number;
}

export interface FlagDefinition {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  conditions: Condition[];
  guard: GuardSettings;
  version: number;
  updatedAt: string;
}

export interface FlagSnapshot {
  revision: number;
  flags: FlagDefinition[];
}

export interface User {
  id: string;
  attributes?: Record<string, string>;
}

export type DecisionReason =
  | "flagNotFound"
  | "disabled"
  | "conditionNotMet"
  | "outsideRollout"
  | "inRollout";

export interface Decision {
  flagKey: string;
  enabled: boolean;
  reason: DecisionReason;
}
