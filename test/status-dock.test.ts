import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { computeUsage, renderStatusDock, validExtensionStatuses } from "../src/status-dock.ts";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function context(options: { percent?: number; entries?: any[]; branch?: any[] } = {}) {
  let percent = options.percent ?? 10;
  const ctx = {
    model: { id: "fornace-model-with-a-long-name", provider: "mantice", reasoning: true, contextWindow: 200_000 },
    sessionManager: {
      getEntries: () => options.entries ?? [],
      getBranch: () => options.branch ?? [],
      getCwd: () => "/Users/example/project",
      getSessionId: () => "session-id",
      getSessionName: () => null,
    },
    getContextUsage: () => ({ percent, contextWindow: 200_000 }),
  } as never;
  return { ctx, setPercent: (next: number) => { percent = next; } };
}

const footer = {
  getGitBranch: () => "main",
  getAvailableProviderCount: () => 2,
  getExtensionStatuses: () => new Map<string, string>(),
  onBranchChange: () => () => {},
};

test("normal dock stays within four rows and always ends in its action hint", () => {
  const { ctx } = context();
  for (const maxRows of [0, 1, 2, 3, 4, 20]) {
    const rows = renderStatusDock(42, ctx, footer, "high", false, () => null, maxRows);
    assert.ok(rows.length <= Math.min(4, maxRows));
    assert.ok(rows.every((line) => visibleWidth(line) <= 42));
    if (maxRows > 0) assert.match(stripAnsi(rows.at(-1)!), /Ctrl\+Shift\+H focus/);
  }
});

test("goal uses at most two readable rows", () => {
  const goalEntry = {
    type: "custom", customType: "pi-codex-goal", id: "goal", timestamp: "goal",
    data: {
      version: 1, kind: "set", source: "tool", at: 2,
      goal: {
        goalId: "g", objective: "A long objective that should occupy the available goal line rather than being squeezed after telemetry",
        status: "active", tokenBudget: 1_000_000,
        usage: { tokensUsed: 500_000, activeSeconds: 60 }, createdAt: 1, updatedAt: 2,
      },
    },
  };
  const { ctx } = context({ branch: [goalEntry] });
  const clean = renderStatusDock(42, ctx, footer, "high", false, () => null, 4).map(stripAnsi);
  assert.match(clean[0]!, /active 500k\/1.0M 1m/);
  assert.match(clean[1]!, /A long objective that should occupy/);
  assert.ok(clean.length <= 4);
});

test("cmux surface ref survives by truncating the title first", () => {
  const { ctx } = context();
  const rows = renderStatusDock(
    42, ctx, footer, "high", false,
    () => ({ workspaceTitle: "An extremely long workspace title that cannot fit", workspaceRef: "workspace:7", surfaceRef: "surface:38" }),
    4,
  );
  const clean = rows.map(stripAnsi);
  assert.match(clean[0]!, /surface:38/);
  assert.match(clean[0]!, /An extremely/);
});

test("live context values update while persisted entries are unchanged", () => {
  const state = context({ percent: 10, entries: [{ id: "same", timestamp: "same", type: "message", message: { role: "user" } }] });
  assert.equal(computeUsage(state.ctx).contextPercent, 10);
  state.setPercent(74);
  assert.equal(computeUsage(state.ctx).contextPercent, 74);
});

test("usage caches are isolated per extension context", () => {
  const assistant = (id: string, input: number) => ({ id, timestamp: id, type: "message", message: { role: "assistant", usage: { input, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } });
  const first = context({ entries: [assistant("same", 10)] }).ctx;
  const second = context({ entries: [assistant("same", 99)] }).ctx;
  assert.equal(computeUsage(first).input, 10);
  assert.equal(computeUsage(second).input, 99);
});

test("status rows accept only non-empty string values", () => {
  const malformed = {
    ...footer,
    getExtensionStatuses: () => new Map<any, any>([
      ["empty", " \n "],
      ["number", 12],
      ["good", "  healthy\nnow  "],
      [7, "bad key"],
    ]),
  };
  assert.deepEqual(validExtensionStatuses(malformed), ["healthy now"]);
});
