import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bucket, murmur3 } from "../src/murmur.js";
import { evaluateFlag } from "../src/evaluate.js";
import type { FlagDefinition, User } from "../src/types.js";

const spec = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../spec/${name}.json`, import.meta.url)), "utf8"));

const encode = (text: string) => new TextEncoder().encode(text);

describe("murmur3", () => {
  it.each([
    ["", 0x00000000],
    ["a", 0x3c2569b2],
    ["abc", 0xb3dd93fa],
    ["hello", 0x248bfa47],
    ["The quick brown fox jumps over the lazy dog", 0x2e4ff723],
  ])("hashes %j to the reference value", (text, expected) => {
    expect(murmur3(encode(text))).toBe(expected);
  });
});

describe("shared bucketing vectors", () => {
  const vectors = spec("bucketing") as { flagKey: string; userId: string; bucket: number }[];

  it("matches every recorded bucket", () => {
    for (const v of vectors) {
      expect(bucket(v.flagKey, v.userId), `${v.flagKey}:${v.userId.slice(0, 20)}`).toBe(v.bucket);
    }
  });

  it("always lands inside the bucket range", () => {
    for (const v of vectors) {
      expect(v.bucket).toBeGreaterThanOrEqual(0);
      expect(v.bucket).toBeLessThan(10_000);
    }
  });
});

describe("shared evaluation vectors", () => {
  const vectors = spec("evaluation") as {
    flag: FlagDefinition;
    user: User;
    enabled: boolean;
    reason: string;
  }[];

  it("matches every recorded decision", () => {
    for (const v of vectors) {
      const decision = evaluateFlag(v.flag, v.user);
      expect(decision.enabled, `${v.flag.key}/${v.user.id}`).toBe(v.enabled);
      expect(decision.reason, `${v.flag.key}/${v.user.id}`).toBe(v.reason);
    }
  });
});

describe("rollout accuracy", () => {
  it.each([1, 5, 25, 50, 90])("enables about %i%% of 50,000 users", (percent) => {
    const flag: FlagDefinition = {
      key: "accuracy",
      description: "",
      enabled: true,
      rolloutPercent: percent,
      conditions: [],
      guard: { enabled: true, mode: "auto", minSamples: 100, alpha: 0.001, minDifference: 0.05, windowSeconds: 30 },
      version: 1,
      updatedAt: "",
    };
    const total = 50_000;
    let enabled = 0;
    for (let i = 0; i < total; i++) {
      if (evaluateFlag(flag, { id: `user-${i}` }).enabled) enabled++;
    }
    const expected = (percent / 100) * total;
    const tolerance = 4 * Math.sqrt(total * (percent / 100) * (1 - percent / 100));
    expect(Math.abs(enabled - expected)).toBeLessThan(tolerance);
  });
});
