import assert from "node:assert/strict";
import test from "node:test";
import { computeUsage, validExtensionStatuses } from "../src/status-dock.ts";

function assistant(id: string, usage: Record<string, unknown>) {
  return {
    type: "message",
    id,
    timestamp: "2026-09-09T12:00:00Z",
    message: { role: "assistant", content: "reply", usage },
  };
}

function usageContext(entries: unknown[], percent: number | null, contextWindow = 200_000) {
  return {
    ui: { theme: {}, notify() {} },
    model: { id: "model", provider: "test", reasoning: true, contextWindow },
    modelRegistry: {},
    sessionManager: {
      getEntries: () => entries,
      getBranch: () => entries,
      getCwd: () => "/tmp/project",
      getSessionId: () => "01234567-89ab-cdef-0123-456789abcdef",
      getSessionFile: () => "/tmp/session.jsonl",
      getSessionName: () => "session",
    },
    getContextUsage: () => (percent === null ? undefined : { tokens: 1, contextWindow, percent }),
  } as never;
}

test("live context values update while persisted entries are unchanged", () => {
  const entries = [assistant("a", { input: 10, output: 5, cost: { total: 0.25 } })];
  let percent = 10;
  const ctx = {
    ...(usageContext(entries, 10) as unknown as Record<string, unknown>),
    getContextUsage: () => ({ tokens: 1, contextWindow: 200_000, percent }),
  } as never;

  assert.equal(computeUsage(ctx).contextPercent, 10);
  percent = 82;
  // Entries did not change, so totals come from cache, but context is resampled.
  const second = computeUsage(ctx);
  assert.equal(second.contextPercent, 82);
  assert.equal(second.cost, 0.25);
});

test("usage caches are isolated per extension context", () => {
  const first = usageContext([assistant("a", { input: 100, cost: { total: 1 } })], 5);
  const second = usageContext([assistant("b", { input: 7, cost: { total: 2 } })], 5);

  assert.equal(computeUsage(first).input, 100);
  assert.equal(computeUsage(second).input, 7);
  // Re-reading the first context must not hand back the second context's totals.
  assert.equal(computeUsage(first).input, 100);
  assert.equal(computeUsage(first).cost, 1);
});

test("a missing or non-finite context reading degrades to a null percent", () => {
  assert.equal(computeUsage(usageContext([], null)).contextPercent, null);

  const nonFinite = {
    ...(usageContext([], 5) as unknown as Record<string, unknown>),
    getContextUsage: () => ({ tokens: 1, contextWindow: 200_000, percent: Number.NaN }),
  } as never;
  assert.equal(computeUsage(nonFinite).contextPercent, null);

  // Falls back to the model's declared window when the reading omits one.
  const noWindow = {
    ...(usageContext([], 5) as unknown as Record<string, unknown>),
    getContextUsage: () => ({ tokens: 1, percent: 5 }),
  } as never;
  assert.equal(computeUsage(noWindow).contextWindow, 200_000);
});

test("status rows accept only non-empty string values", () => {
  const statuses = new Map<string, unknown>([
    ["b", "second"],
    ["a", "first"],
    ["blank", "   "],
    ["newlines", "one\ntwo\tthree"],
    ["wrong-type", 42],
  ]);
  const footer = {
    getGitBranch: () => null,
    getExtensionStatuses: () => statuses,
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  } as never;

  // Sorted by key, blanks and non-strings dropped, whitespace collapsed.
  assert.deepEqual(validExtensionStatuses(footer), ["first", "second", "one two three"]);
  assert.deepEqual(validExtensionStatuses(null), []);
});
