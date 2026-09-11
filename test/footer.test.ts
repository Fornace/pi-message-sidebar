import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderFooterRail, FOOTER_MODE_HINT, type FooterRailInput } from "../src/footer-rail.ts";
import { resolvePalette } from "../src/palette.ts";
import type { Usage } from "../src/status-dock.ts";
import type { UserMessage } from "../src/types.ts";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

const USAGE: Usage = {
  input: 10_000,
  output: 2_000,
  cacheRead: 4_000,
  cacheWrite: 1_000,
  cost: 1.24,
  contextPercent: 38,
  contextWindow: 200_000,
};

function makeInput(overrides: Partial<FooterRailInput> = {}): FooterRailInput {
  const messages: UserMessage[] = [{
    id: "m1",
    index: 1,
    timestamp: new Date(2026, 8, 10, 9, 30).toISOString(),
    text: "ship the footer mode for small terminals",
  }];
  return {
    ctx: {
      model: { id: "fornace-max", provider: "mantice", reasoning: true },
      sessionManager: { getCwd: () => "/Users/ffrappo/repos/pi-message-sidebar" },
    } as never,
    footerData: { getAvailableProviderCount: () => 2 } as never,
    palette: resolvePalette(null),
    goal: null,
    usage: USAGE,
    messages,
    summaryFor: () => "Ship footer mode for small terminals",
    ...overrides,
  };
}

test("the footer renders exactly two rows of exactly the terminal width", () => {
  for (const width of [30, 40, 60, 80, 100, 120, 160]) {
    const lines = renderFooterRail(makeInput(), width);
    assert.equal(lines.length, 2, `rows at width=${width}`);
    for (const [index, line] of lines.entries()) {
      assert.equal(visibleWidth(line), width, `row ${index} at width=${width}`);
    }
  }
});

test("the stream row always carries the way back to the rail", () => {
  for (const width of [30, 60, 80, 120]) {
    const clean = renderFooterRail(makeInput(), width).map(stripAnsi);
    assert.ok(clean[1]!.includes(FOOTER_MODE_HINT), `hint at width=${width}`);
    assert.ok(clean[1]!.includes("»"), `tail marker at width=${width}`);
  }
});

test("the status row keeps the goal and context meter over cost and model", () => {
  const wide = stripAnsi(renderFooterRail(makeInput(), 120)[0]!);
  assert.match(wide, /no goal/);
  assert.match(wide, /ctx/);
  assert.match(wide, /38%/);
  assert.match(wide, /fornace-max/);

  const narrow = stripAnsi(renderFooterRail(makeInput(), 58)[0]!);
  assert.match(narrow, /no goal/, "the goal segment survives the packer");
  assert.match(narrow, /ctx/);
  assert.ok(!narrow.includes("fornace-max"), "the model is dropped before the goal");
});

test("a live goal shows its status and budget share", () => {
  const input = makeInput({
    goal: {
      goalId: "g1",
      objective: "ship it",
      status: "active",
      tokenBudget: 1_000_000,
      usage: { tokensUsed: 420_000, activeSeconds: 600 },
      createdAt: 0,
      updatedAt: 100,
    } as never,
  });
  const clean = stripAnsi(renderFooterRail(input, 100)[0]!);
  assert.match(clean, /● ACTIVE 42%/);
});

test("the stream tail shows the last message summary, the cwd when silent", () => {
  const withMessages = stripAnsi(renderFooterRail(makeInput(), 100)[1]!);
  assert.match(withMessages, /Ship footer mode for small terminals/);

  const empty = stripAnsi(renderFooterRail(makeInput({ messages: [], summaryFor: () => "" }), 100)[1]!);
  assert.ok(empty.includes("pi-message-sidebar"), "an empty session falls back to the cwd");
});

test("no segment ever overflows under a hostile width", () => {
  for (const width of [1, 2, 3, 5, 8, 13, 21]) {
    const lines = renderFooterRail(makeInput(), width);
    for (const [index, line] of lines.entries()) {
      assert.ok(
        visibleWidth(line) <= width,
        `row ${index} overflows at width=${width}`,
      );
    }
  }
});
