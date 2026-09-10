import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SIDEBAR_WIDTH } from "../src/constants.ts";
import { SidebarComponent, minimumHeight, type UserMessage } from "../src/sidebar-component.ts";
import { fallbackTitle } from "../src/titles.ts";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function fakeContext(messages: UserMessage[]) {
  const branch = messages.map((message) => ({
    type: "message",
    id: message.id,
    timestamp: message.timestamp,
    message: { role: "user", content: message.text },
  }));
  return {
    ui: { theme: {}, notify() {} },
    model: { id: "model-with-a-long-name", provider: "test", reasoning: true, contextWindow: 200_000 },
    modelRegistry: {},
    sessionManager: {
      getBranch: () => branch,
      getEntries: () => branch,
      getCwd: () => "/Users/example/a-very-long-project-directory-name",
      getSessionId: () => "01234567-89ab-cdef-0123-456789abcdef",
      getSessionFile: () => "/tmp/a-very-long-session-file-name.jsonl",
      getSessionName: () => "A very long session name that must be truncated",
    },
    getContextUsage: () => ({ tokens: 180_000, contextWindow: 200_000, percent: 90 }),
  } as never;
}

function fakeTui(rows = 24) {
  return {
    terminal: { rows, columns: 160 },
    requestRender() {},
    setFocus() {},
  } as never;
}

function makeSidebar(messages: UserMessage[], rows = 24) {
  return new SidebarComponent({
    tui: fakeTui(rows),
    ctx: fakeContext(messages),
    messages,
    getThinkingLevel: () => "high",
    getCmuxContext: () => null,
    getFooterData: () => null,
    getTitle: (_id, text) => fallbackTitle(text),
  });
}

function messages(count: number): UserMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
    index: index + 1,
    timestamp: new Date(2026, 8, 9, 12, index).toISOString(),
    text: `unique-message-${index} with enough text to identify this chronological row`,
  }));
}

test("sidebar lines fit at every supported component width", () => {
  const history = messages(24);
  const ctx = fakeContext(history);
  (ctx as any).sessionManager.getBranch = () => [
    ...(ctx as any).sessionManager.getEntries(),
    {
      type: "custom", customType: "pi-codex-goal", id: "goal", timestamp: "2026-09-09T12:30:00Z",
      data: {
        version: 1, kind: "set", source: "tool", at: 200,
        goal: {
          goalId: "g1",
          objective: "Upgrade the sidebar with a compact goal recap while keeping every line inside its width",
          status: "active",
          tokenBudget: 3_000_000,
          usage: { tokensUsed: 1_234_567, activeSeconds: 2_460 },
          createdAt: 100,
          updatedAt: 200,
        },
      },
    },
  ];
  const sidebar = new SidebarComponent({
    tui: fakeTui(), ctx, messages: history, getThinkingLevel: () => "xhigh",
    getCmuxContext: () => ({ workspaceTitle: "π - imagineer-standalone with a very long title", workspaceRef: "workspace:7", surfaceRef: "surface:38" }),
    getFooterData: () => ({
      getGitBranch: () => "feature/a-very-long-branch-name",
      getExtensionStatuses: () => new Map([["goal", "A long extension status that needs clipping"]]),
      getAvailableProviderCount: () => 4,
      onBranchChange: () => () => {},
    }),
    getTitle: (_id, text) => fallbackTitle(text),
  });

  for (const width of [1, 8, 16, 24, 35, SIDEBAR_WIDTH]) {
    const lines = sidebar.render(width);
    assert.equal(lines.length, 24);
    assert.ok(lines.every((line) => visibleWidth(line) <= width), `overflow at width ${width}`);
    sidebar.invalidate();
  }
});

test("message rows spend their width on the title and keep position in the heading", () => {
  const sidebar = makeSidebar(messages(1), 24);
  const lines = sidebar.render(SIDEBAR_WIDTH).map(stripAnsi);
  const bodyRow = lines.find((line) => line.includes("unique-message-0"));
  assert.ok(bodyRow);
  assert.match(bodyRow, /unique-message-0 with enough text/);
  // Position lives in the MESSAGES heading, never on a body row.
  const heading = lines.find((line) => line.includes("MESSAGES"));
  assert.ok(heading);
  assert.match(heading, /MESSAGES\s+1\/1/);
  assert.ok(!bodyRow.includes("1/1"));
});

test("expanded messages stay bounded", () => {
  const history = [{
    id: "1", index: 1, timestamp: new Date().toISOString(),
    text: "supercalifragilisticexpialidocious/without/any/breaks/and/with/你好世界".repeat(4),
  }];
  const sidebar = makeSidebar(history);
  sidebar.setFocused(true);
  sidebar.handleInput("\r");
  assert.ok(sidebar.render(35).every((line) => visibleWidth(line) <= 35));
});

test("selection and expansion survive message insertion by ID", () => {
  const history: UserMessage[] = ["a", "b", "c"].map((id, index) => ({
    id, index: index + 1, timestamp: new Date(2026, 8, 9, 12, index).toISOString(), text: `message-${id}`,
  }));
  const sidebar = makeSidebar(history);
  sidebar.setFocused(true);
  sidebar.handleInput("\x1b[A");
  sidebar.handleInput("\r");
  assert.equal(sidebar.getSelectedMessageId(), "b");
  assert.equal(sidebar.isExpanded("b"), true);
  assert.equal(sidebar.isFollowingTail(), false);

  sidebar.updateMessages([
    { id: "x", index: 1, timestamp: history[0]!.timestamp, text: "inserted" },
    ...history.map((message, index) => ({ ...message, index: index + 2 })),
    { id: "d", index: 5, timestamp: new Date().toISOString(), text: "newest" },
  ]);
  assert.equal(sidebar.getSelectedMessageId(), "b");
  assert.equal(sidebar.isExpanded("b"), true);
  assert.equal(sidebar.isFollowingTail(), false);
});

test("follow-tail selects new messages until the user browses away", () => {
  const initial = messages(1);
  const sidebar = makeSidebar(initial);
  sidebar.updateMessages(messages(2));
  assert.equal(sidebar.getSelectedMessageId(), "id-1");
  sidebar.handleInput("\x1b[A");
  sidebar.updateMessages(messages(3));
  assert.equal(sidebar.getSelectedMessageId(), "id-0");
});

test("viewport is one contiguous chronological range without newest teleporting", () => {
  const history = messages(30);
  const sidebar = makeSidebar(history, 24);
  sidebar.setFocused(true);
  sidebar.handleInput("\x1b[H");
  const clean = stripAnsi(sidebar.render(SIDEBAR_WIDTH).join("\n"));
  assert.match(clean, /unique-message-0/);
  assert.match(clean, /unique-message-1/);
  assert.doesNotMatch(clean, /unique-message-29/);
  assert.doesNotMatch(clean, /hidden/);
});

test("short histories top-align under the heading and pad below the last message", () => {
  const sidebar = makeSidebar(messages(2), 24);
  const clean = sidebar.render(SIDEBAR_WIDTH).map(stripAnsi);
  const heading = clean.findIndex((line) => line.includes("MESSAGES"));
  const first = clean.findIndex((line) => line.includes("unique-message-0"));
  const second = clean.findIndex((line) => line.includes("unique-message-1"));
  assert.ok(heading >= 0);
  // Chronological, contiguous, and immediately below the heading block.
  assert.equal(second, first + 1);
  assert.ok(first > heading && first - heading <= 2);
  // Padding sits below the last message, never between the heading and the first row.
  assert.ok(clean.slice(heading + 1, first).every((line) => line.trim() === "|" || line.trim() === ""
    || /^\|?\s*$/.test(line.replace(/│/g, "|"))));
});

test("heights below the mandatory budget show a bounded notice instead of clipped sections", () => {
  const history = messages(1);
  const floor = minimumHeight(false);
  for (const rows of [1, 2, 3, 4, 5, 8, floor - 1]) {
    const sidebar = makeSidebar(history, rows);
    const lines = sidebar.render(SIDEBAR_WIDTH);
    assert.equal(lines.length, rows);
    assert.ok(lines.every((line) => visibleWidth(line) <= SIDEBAR_WIDTH));
    assert.match(stripAnsi(lines[0]!), /Sidebar/, `notice missing at ${rows} rows`);
  }
});

test("the mandatory budget renders every section, message row included", () => {
  const history = messages(1);
  const sidebar = makeSidebar(history, minimumHeight(false));
  const clean = sidebar.render(SIDEBAR_WIDTH).map(stripAnsi);
  const joined = clean.join("\n");
  for (const required of [/GOAL/, /SESSION/, /MESSAGES/, /unique-message-0/, /model-with-a-long-name/, /ctx 90%/]) {
    assert.match(joined, required, `missing ${required} at the mandatory budget`);
  }
});

test("every rail row paints the full sidebar width at every viable height", () => {
  const history = messages(3);
  for (let rows = minimumHeight(false); rows <= 60; rows++) {
    const lines = makeSidebar(history, rows).render(SIDEBAR_WIDTH);
    assert.equal(lines.length, rows);
    assert.ok(
      lines.every((line) => visibleWidth(line) === SIDEBAR_WIDTH),
      `rail does not fill ${SIDEBAR_WIDTH} columns at ${rows} rows`,
    );
  }
});
