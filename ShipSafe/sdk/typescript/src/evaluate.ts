import { bucket } from "./murmur.js";
import type { Condition, Decision, FlagDefinition, User } from "./types.js";

export function threshold(percent: number): number {
  return Math.round(percent * 100);
}

function attributeOf(user: User, name: string): string | undefined {
  const wanted = name.toLowerCase();
  if (wanted === "id") {
    return user.id;
  }
  for (const [key, value] of Object.entries(user.attributes ?? {})) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return undefined;
}

function matches(condition: Condition, user: User): boolean {
  const actual = attributeOf(user, condition.attribute)?.toLowerCase();
  const listed = actual !== undefined && condition.values.some((v) => v.toLowerCase() === actual);
  return condition.operator === "in" ? listed : !listed;
}

export function evaluateFlag(flag: FlagDefinition, user: User): Decision {
  if (!flag.enabled) {
    return { flagKey: flag.key, enabled: false, reason: "disabled" };
  }
  if (!flag.conditions.every((c) => matches(c, user))) {
    return { flagKey: flag.key, enabled: false, reason: "conditionNotMet" };
  }
  const inRollout = bucket(flag.key, user.id) < threshold(flag.rolloutPercent);
  return { flagKey: flag.key, enabled: inRollout, reason: inRollout ? "inRollout" : "outsideRollout" };
}
