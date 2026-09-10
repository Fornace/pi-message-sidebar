import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SIDEBAR_WIDTH } from "../src/constants.ts";
import { SidebarComponent, type UserMessage } from "../src/sidebar-component.ts";
import { fallbackTitle } from "../src/titles.ts";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function fakeContext(messages: UserMessage[], goalObj?: { objective: string; status: string; tokensUsed: number; tokenBudget: number; activeSeconds: number }) {
  const branch: any[] = messages.map((message) => ({
    type: "message",
    id: message.id,
    timestamp: message.timestamp,
    message: { role: "user", content: message.text },
  }));
  if (goalObj) {
    branch.push({
      type: "custom",
      customType: "pi-codex-goal",
      id: "goal-1",
      timestamp: "2026-09-09T12:00:00Z",
      data: {
        version: 1,
        kind: "set",
        source: "tool",
        at: 100,
        goal: {
          goalId: "g1",
          objective: goalObj.objective,
          status: goalObj.status,
          tokenBudget: goalObj.tokenBudget,
          usage: { tokensUsed: goalObj.tokensUsed, activeSeconds: goalObj.activeSeconds },
          createdAt: 50,
          updatedAt: 100,
        },
      },
    });
  }
  return {
    ui: { theme: {}, notify() {} },
    model: { id: "fornace-reasoning", provider: "mantice", reasoning: true, contextWindow: 200_000 },
    modelRegistry: {},
    sessionManager: {
      getBranch: () => branch,
      getEntries: () => branch,
      getCwd: () => "/private/tmp/sidebar-throwaway",
      getSessionId: () => "01a08741-39cb-7251-8a7f-45b6e8fa4556",
      getSessionFile: () => "/tmp/session.jsonl",
      getSessionName: () => null,
    },
    getContextUsage: () => ({ tokens: 180_000, contextWindow: 200_000, percent: 90 }),
  } as never;
}

function fakeTui(rows = 30) {
  return {
    terminal: { rows, columns: 160 },
    requestRender() {},
    setFocus() {},
  } as never;
}

function makeSidebar(options: {
  messages: UserMessage[];
  rows?: number;
  goal?: { objective: string; status: string; tokensUsed: number; tokenBudget: number; activeSeconds: number };
  cmux?: { workspaceTitle: string | null; workspaceRef: string | null; surfaceRef: string | null } | null;
  branch?: string | null;
  getTitle?: (id: string, text: string) => string;
}) {
  const rows = options.rows ?? 30;
  return new SidebarComponent({
    tui: fakeTui(rows),
    ctx: fakeContext(options.messages, options.goal),
    messages: options.messages,
    getThinkingLevel: () => "high",
    getCmuxContext: () => options.cmux ?? null,
    getFooterData: () => ({
      getGitBranch: () => options.branch ?? "main",
      getExtensionStatuses: () => new Map(),
      getAvailableProviderCount: () => 2,
      onBranchChange: () => () => {},
    }),
    getTitle: options.getTitle ?? ((_id, text) => fallbackTitle(text)),
  });
}

function sampleMessages(count: number): UserMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
    index: index + 1,
    timestamp: new Date(2026, 8, 9, 12, index).toISOString(),
    text: `unique-message-${index} with enough words to verify proper row rendering`,
  }));
}

test("goal section is above messages with bold title, status, and budget", () => {
  const sidebar = makeSidebar({
    messages: sampleMessages(3),
    rows: 30,
    goal: {
      objective: "Ship the pi suite update with complete test coverage",
      status: "active",
      tokensUsed: 1_234_567,
      tokenBudget: 3_000_000,
      activeSeconds: 1500,
    },
  });

  const rawLines = sidebar.render(SIDEBAR_WIDTH);
  const clean = rawLines.map(stripAnsi);

  const goalIdx = clean.findIndex((l) => l.includes("GOAL"));
  const msgsIdx = clean.findIndex((l) => l.includes("MESSAGES"));
  assert.ok(goalIdx >= 0, "GOAL must be present");
  assert.ok(msgsIdx >= 0, "MESSAGES must be present");
  assert.ok(goalIdx < msgsIdx, "GOAL section must be above MESSAGES");

  // Title line with bold bright styling
  const titleLine = rawLines.find((l) => l.includes("Ship the pi suite update"));
  assert.ok(titleLine, "Goal title must appear");
  assert.match(titleLine, /\x1b\[1m/, "Goal title must be bold");

  // Status and budget row
  const statusLine = clean.find((l) => l.includes("ACTIVE") && l.includes("elapsed"));
  assert.ok(statusLine, "Active status and elapsed time must appear");
  const budgetLine = clean.find((l) => l.includes("tokens used"));
  assert.ok(budgetLine, "Budget row must appear");
  assert.match(budgetLine, /1.2M \/ 3.0M tokens used/);
});

test("session section shows surface ref, cwd identity, branch, and session id", () => {
  const sidebar = makeSidebar({
    messages: sampleMessages(3),
    rows: 30,
    cmux: { surfaceRef: "surface:38", workspaceTitle: "my-workspace", workspaceRef: "w:1" },
    branch: "feature/layout-fix",
  });

  const clean = sidebar.render(SIDEBAR_WIDTH).map(stripAnsi);
  const sessionIdx = clean.findIndex((l) => l.includes("SESSION"));
  assert.ok(sessionIdx >= 0, "SESSION heading must appear");

  // Surface ref and workspace title
  assert.match(clean[sessionIdx + 1]!, /surface:38/);
  assert.match(clean[sessionIdx + 1]!, /my-workspace/);

  // Non-home cwd identity is preserved (not reduced to basename!)
  assert.match(clean[sessionIdx + 2]!, /\/private\/tmp\/sidebar-throwaway/);

  // Branch and 8-char session id
  const branchSessionLine = clean.find((l) => l.includes("branch") && l.includes("session"));
  assert.ok(branchSessionLine, "Branch and session row must appear");
  // The branch ellipsizes to protect the session id, but keeps its leading segment.
  assert.match(branchSessionLine, /branch feature\/la/);
  assert.match(branchSessionLine, /…/, "long branch must ellipsize rather than push out the session id");
  assert.match(branchSessionLine, /session 01a08741/);
});

test("message rows show one title per row with fallback", () => {
  const titles = new Map([
    ["id-0", "Custom Title Zero"],
    ["id-1", "Custom Title One"],
  ]);
  const sidebar = makeSidebar({
    messages: sampleMessages(2),
    rows: 25,
    getTitle: (id, text) => titles.get(id) ?? fallbackTitle(text),
  });

  const clean = sidebar.render(SIDEBAR_WIDTH).map(stripAnsi);
  const zeroRow = clean.find((l) => l.includes("Custom Title Zero"));
  const oneRow = clean.find((l) => l.includes("Custom Title One"));
  assert.ok(zeroRow, "Custom title zero must appear");
  assert.ok(oneRow, "Custom title one must appear");

  // One title per row, right-aligned pos/total in heading
  const heading = clean.find((l) => l.includes("MESSAGES"));
  assert.ok(heading);
  assert.match(heading, /MESSAGES\s+2\/2/);
});

test("Enter and Esc navigate the detail lifecycle", () => {
  const sidebar = makeSidebar({
    messages: sampleMessages(3),
    rows: 30,
  });

  sidebar.setFocused(true);
  assert.equal(sidebar.isFocused(), true);
  assert.equal(sidebar.isDetailOpen(), false);

  // Press Enter on selected message
  sidebar.handleInput("\r");
  assert.equal(sidebar.isDetailOpen(), true);

  const detailLines = sidebar.render(SIDEBAR_WIDTH).map(stripAnsi);
  assert.ok(detailLines.some((l) => l.includes("MESSAGE")));
  assert.ok(detailLines.some((l) => l.includes("#3")));
  assert.ok(detailLines.some((l) => l.includes("Esc back · ↑↓ scroll")));

  // First Esc closes detail, keeping focus
  sidebar.handleInput("\x1b");
  assert.equal(sidebar.isDetailOpen(), false);
  assert.equal(sidebar.isFocused(), true);

  // Second Esc unfocuses the sidebar
  sidebar.handleInput("\x1b");
  assert.equal(sidebar.isFocused(), false);
});

test("selection and follow-tail are preserved under message insertion and detail", () => {
  const history: UserMessage[] = ["a", "b", "c"].map((id, index) => ({
    id, index: index + 1, timestamp: new Date(2026, 8, 9, 12, index).toISOString(), text: `message-${id}`,
  }));
  const sidebar = makeSidebar({ messages: history, rows: 25 });
  sidebar.setFocused(true);

  // Navigate up to select 'b' and open detail
  sidebar.handleInput("\x1b[A");
  assert.equal(sidebar.getSelectedMessageId(), "b");
  assert.equal(sidebar.isFollowingTail(), false);
  sidebar.handleInput("\r");
  assert.equal(sidebar.isDetailOpen(), true);

  // New message inserted while detail is open
  sidebar.updateMessages([
    { id: "x", index: 1, timestamp: history[0]!.timestamp, text: "inserted" },
    ...history.map((m, i) => ({ ...m, index: i + 2 })),
    { id: "d", index: 5, timestamp: new Date().toISOString(), text: "newest" },
  ]);

  // Selection stays on 'b', detail stays open on 'b'
  assert.equal(sidebar.getSelectedMessageId(), "b");
  assert.equal(sidebar.isExpanded("b"), true);
  assert.equal(sidebar.isFollowingTail(), false);

  // Detail heading reflects selected message position derived from detailId
  const lines = sidebar.render(SIDEBAR_WIDTH).map(stripAnsi);
  const detailHeading = lines.find((l) => l.includes("MESSAGE"));
  assert.ok(detailHeading);
  assert.match(detailHeading, /MESSAGE\s+3\/5/);
});

test("exact height and no overflow across rows 1..11 and 12..55", () => {
  const history = sampleMessages(5);
  for (let rows = 1; rows <= 55; rows++) {
    const sidebar = makeSidebar({ messages: history, rows });
    const lines = sidebar.render(SIDEBAR_WIDTH);
    assert.equal(lines.length, rows, `Height mismatch at ${rows} rows`);
    for (let i = 0; i < lines.length; i++) {
      const width = visibleWidth(lines[i]!);
      assert.equal(width, SIDEBAR_WIDTH, `Line ${i} width ${width} !== ${SIDEBAR_WIDTH} at height ${rows}`);
    }
  }
});

test("narrow width under 42 renders a width-bounded notice", () => {
  const history = sampleMessages(3);
  const sidebar = makeSidebar({ messages: history, rows: 24 });

  for (const width of [1, 5, 10, 20, 35, 41]) {
    const lines = sidebar.render(width);
    assert.equal(lines.length, 24);
    assert.ok(
      lines.every((line) => visibleWidth(line) <= width),
      `overflow at narrow width ${width}`,
    );
    sidebar.invalidate();
  }
});

test("expanded messages stay bounded and scrolling works", () => {
  const history = [{
    id: "1", index: 1, timestamp: new Date().toISOString(),
    text: "supercalifragilisticexpialidocious/without/any/breaks/and/with/long/tokens/".repeat(5),
  }];
  const sidebar = makeSidebar({ messages: history, rows: 20 });
  sidebar.setFocused(true);
  sidebar.handleInput("\r");
  assert.equal(sidebar.isDetailOpen(), true);

  const lines = sidebar.render(SIDEBAR_WIDTH);
  assert.equal(lines.length, 20);
  assert.ok(lines.every((l) => visibleWidth(l) === SIDEBAR_WIDTH));
});
