import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SIDEBAR_WIDTH } from "../src/constants.ts";
import { SidebarComponent, minimumHeight, type UserMessage } from "../src/sidebar-component.ts";
import { fallbackSummary } from "../src/summaries.ts";

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
  getSummary?: (id: string, text: string) => string;
  hasSummary?: (id: string) => boolean;
  summariesConfigured?: boolean;
  editedFiles?: string[];
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
    getSummary: options.getSummary ?? ((_id, text) => fallbackSummary(text)),
    hasSummary: options.hasSummary ?? (() => true),
    summariesConfigured: () => options.summariesConfigured ?? true,
    getEditedFiles: () => (options.editedFiles ?? []).map((path, index) => ({ path, edits: index === 0 ? 3 : 1 })),
  });
}

const GOAL = {
  objective: "Upgrade the sidebar with a goal recap that keeps every line inside its width",
  status: "active",
  tokensUsed: 1_234_567,
  tokenBudget: 3_000_000,
  activeSeconds: 2_460,
};

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
  const summaries = new Map([
    ["id-0", "Fix the rail row budget so sections fill"],
    ["id-1", "Add a fuzz harness for the wrap cache"],
  ]);
  const sidebar = makeSidebar({
    messages: sampleMessages(2),
    rows: 25,
    getSummary: (id, text) => summaries.get(id) ?? fallbackSummary(text),
  });

  const clean = sidebar.render(SIDEBAR_WIDTH).map(stripAnsi);
  const zeroRow = clean.find((l) => l.includes("Fix the rail row budget"));
  const oneRow = clean.find((l) => l.includes("Add a fuzz harness"));
  assert.ok(zeroRow, "Summary zero must appear");
  assert.ok(oneRow, "Summary one must appear");

  // Structured rows: ordinal and time precede the summary text
  assert.match(zeroRow, / 1 12:00 Fix the rail row budget/);

  // Right-aligned pos/total in heading
  const heading = clean.find((l) => l.includes("MESSAGES"));
  assert.ok(heading);
  assert.match(heading, /MESSAGES\s+2\/2/);
});

test("the files section summarizes edited files between session and messages", () => {
  const sidebar = makeSidebar({
    messages: sampleMessages(3),
    rows: 34,
    editedFiles: ["/very/deep/path/repo/src/sidebar-component.ts", "/repo/README.md", "/repo/CHANGELOG.md"],
  });

  const clean = sidebar.render(SIDEBAR_WIDTH).map(stripAnsi);
  const filesIdx = clean.findIndex((l) => /FILES\s+3 files/.test(l));
  assert.ok(filesIdx >= 0, "FILES heading with the distinct-file count must appear");

  // Latest first, deep paths front-truncated, repeat count on the most-edited file
  assert.match(clean[filesIdx + 1]!, /…\/path\/repo\/src\/sidebar-component\.ts ×3\s*$/);
  assert.match(clean[filesIdx + 2]!, /\/repo\/README\.md/);

  // Section order: SESSION before FILES before MESSAGES
  const sessionIdx = clean.findIndex((l) => l.includes("SESSION"));
  const messagesIdx = clean.findIndex((l) => l.includes("MESSAGES"));
  assert.ok(sessionIdx < filesIdx && filesIdx < messagesIdx);
});

test("no files section renders when the session has not edited anything", () => {
  const sidebar = makeSidebar({ messages: sampleMessages(2), rows: 30, editedFiles: [] });
  const clean = sidebar.render(SIDEBAR_WIDTH).map(stripAnsi);
  assert.ok(!clean.some((l) => l.includes("FILES")), "an empty edit history must not render a FILES section");
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
  // This message fits, so the hint must not offer a scroll that does nothing.
  assert.ok(detailLines.some((l) => l.includes("Esc back")));
  assert.ok(!detailLines.some((l) => l.includes("↑↓ scroll")));

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

test("every rail row paints all 42 columns at every viable height", () => {
  // A short section is not cosmetic: it surfaces as a fatal height mismatch
  // inside pi's render loop, which is how the getTitle crash took the TUI down.
  for (const goal of [undefined, GOAL]) {
    for (const count of [0, 1, 3, 30]) {
      for (let rows = minimumHeight(Boolean(goal)); rows <= 60; rows++) {
        const lines = makeSidebar({ messages: sampleMessages(count), rows, goal }).render(SIDEBAR_WIDTH);
        assert.equal(lines.length, rows, `height at rows=${rows} count=${count} goal=${Boolean(goal)}`);
        const short = lines.findIndex((l) => visibleWidth(l) !== SIDEBAR_WIDTH);
        assert.equal(short, -1, `row ${short} is ${visibleWidth(lines[short] ?? "")} wide at rows=${rows} count=${count}`);
      }
    }
  }
});

test("an empty history still fills the message section", () => {
  const lines = makeSidebar({ messages: [], rows: 30 }).render(SIDEBAR_WIDTH);
  assert.equal(lines.length, 30);
  assert.match(stripAnsi(lines.join("\n")), /No messages yet/);
  assert.ok(lines.every((l) => visibleWidth(l) === SIDEBAR_WIDTH));
});

test("a message that leaves the branch under an open detail does not break the height", () => {
  const history = sampleMessages(1);
  const sidebar = makeSidebar({ messages: history, rows: 30 });
  sidebar.setFocused(true);
  sidebar.handleInput("\r");
  assert.equal(sidebar.isDetailOpen(), true);

  // Compaction or a branch switch can drop the message the detail is showing.
  (sidebar as unknown as { panel: { messages: UserMessage[] } }).panel.messages = [];
  sidebar.invalidate();
  const lines = sidebar.render(SIDEBAR_WIDTH);
  assert.equal(lines.length, 30);
  assert.match(stripAnsi(lines.join("\n")), /Message unavailable/);
});

test("the detail scroll indicator reports a truthful range at both ends", () => {
  const history = [{
    id: "1", index: 1, timestamp: new Date(2026, 8, 10, 2, 16).toISOString(),
    text: Array.from({ length: 40 }, (_, i) => `line${i} of a message body that wraps`).join(" "),
  }];
  const sidebar = makeSidebar({ messages: history, rows: 24 });
  sidebar.setFocused(true);
  sidebar.handleInput("\r");

  const indicator = () => stripAnsi(sidebar.render(SIDEBAR_WIDTH).find((l) => / of \d+ · ↑↓/.test(stripAnsi(l))) ?? "").trim();
  const atTop = indicator();
  assert.match(atTop, /^│ 1-\d+ of (\d+) · ↑↓ scroll$/);
  const total = Number(atTop.match(/of (\d+)/)![1]);

  for (let i = 0; i < 300; i++) sidebar.handleInput("\x1b[B");
  // At the bottom the last visible line is the last wrapped line — never "0 more".
  assert.match(indicator(), new RegExp(`-${total} of ${total} · ↑↓ scroll$`));

  for (let i = 0; i < 300; i++) sidebar.handleInput("\x1b[A");
  assert.equal(indicator(), atTop);
});

test("a narrow slot never overflows and never leaves a ragged column", () => {
  for (const width of [1, 2, 8, 16, 24, 35, 41]) {
    const lines = makeSidebar({ messages: sampleMessages(3), rows: 30 }).render(width);
    assert.equal(lines.length, 30);
    assert.ok(lines.every((l) => visibleWidth(l) === width), `width ${width} is ragged`);
  }
});

test("the detail hint offers scrolling only when the message overflows", () => {
  const short = makeSidebar({ messages: sampleMessages(1), rows: 30 });
  short.setFocused(true);
  short.handleInput("\r");
  const shortHint = short.render(SIDEBAR_WIDTH).map(stripAnsi).find((l) => l.includes("Esc back"));
  assert.ok(shortHint);
  assert.ok(!shortHint.includes("scroll"), "a message that fits must not advertise scrolling");

  const long = makeSidebar({
    messages: [{
      id: "long", index: 1, timestamp: new Date(2026, 8, 10, 2, 16).toISOString(),
      text: Array.from({ length: 60 }, (_, i) => `line${i} of a message body that wraps`).join(" "),
    }],
    rows: 30,
  });
  long.setFocused(true);
  long.handleInput("\r");
  const longHint = long.render(SIDEBAR_WIDTH).map(stripAnsi).find((l) => l.includes("Esc back"));
  assert.ok(longHint);
  assert.match(longHint, /↑↓ scroll/);
});
