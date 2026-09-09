import assert from "node:assert/strict";
import test from "node:test";
import { readThreadGoal } from "../src/goal.ts";

function setEntry(objective: string, goalId = "g1", status = "active", updatedAt = 100) {
  return {
    type: "custom",
    customType: "pi-codex-goal",
    data: {
      version: 1,
      kind: "set",
      source: "tool",
      goal: {
        goalId,
        objective,
        status,
        tokenBudget: 3_000_000,
        tokensUsed: 0,
        activeSeconds: 0,
        createdAt: 100,
        updatedAt,
      },
    },
  };
}

function usageEntry(goalId: string, tokensUsed: number, activeSeconds: number, updatedAt: number, status = "active") {
  return {
    type: "custom",
    customType: "pi-codex-goal",
    data: { version: 1, kind: "usage", source: "runtime", goalId, status, usage: { tokensUsed, activeSeconds }, updatedAt, at: updatedAt },
  };
}

test("no goal entries yields null", () => {
  assert.equal(readThreadGoal([{ type: "message" }, { type: "custom", customType: "other" }]), null);
});

test("set then usage entries reconstruct the live goal", () => {
  const goal = readThreadGoal([setEntry("Ship it"), usageEntry("g1", 500_000, 600, 200)]);
  assert.equal(goal?.objective, "Ship it");
  assert.equal(goal?.status, "active");
  assert.equal(goal?.tokensUsed, 500_000);
  assert.equal(goal?.activeSeconds, 600);
  assert.equal(goal?.updatedAt, 200);
});

test("clear drops the goal and a later set replaces it", () => {
  const goal = readThreadGoal([
    setEntry("first"),
    { type: "custom", customType: "pi-codex-goal", data: { version: 1, kind: "clear", source: "tool", clearedGoalId: "g1", at: 150 } },
    setEntry("second", "g2"),
  ]);
  assert.equal(goal?.goalId, "g2");
  assert.equal(goal?.objective, "second");
});

test("stale or foreign usage entries are ignored", () => {
  const goal = readThreadGoal([
    setEntry("Ship it"),
    usageEntry("other", 9_999_999, 9_999, 999), // wrong goal id
    usageEntry("g1", 100, 10, 50), // older updatedAt than the set entry
  ]);
  assert.equal(goal?.tokensUsed, 0);
  assert.equal(goal?.activeSeconds, 0);
});

test("budgetLimited goal rejects regression to active", () => {
  const limited = readThreadGoal([
    setEntry("Ship it"),
    usageEntry("g1", 3_000_000, 600, 200, "budgetLimited"),
    usageEntry("g1", 3_000_000, 700, 300, "active"),
  ]);
  assert.equal(limited?.status, "budgetLimited");
  assert.equal(limited?.activeSeconds, 600);
});

test("complete goal ignores later usage entries", () => {
  const done = readThreadGoal([
    setEntry("Ship it"),
    usageEntry("g1", 100, 10, 200, "budgetLimited"),
    { type: "custom", customType: "pi-codex-goal", data: { version: 1, kind: "set", source: "tool", goal: { goalId: "g1", objective: "Ship it", status: "complete", tokenBudget: null, tokensUsed: 100, activeSeconds: 10, createdAt: 100, updatedAt: 400 } } },
    usageEntry("g1", 200, 20, 500),
  ]);
  assert.equal(done?.status, "complete");
  assert.equal(done?.tokensUsed, 100);
});
