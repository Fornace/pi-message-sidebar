import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SIDEBAR_WIDTH } from "../src/constants.ts";
import { SidebarComponent, type UserMessage } from "../src/sidebar-component.ts";

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

function fakeTui() {
  return {
    terminal: { rows: 24, columns: 160 },
    requestRender() {},
    setFocus() {},
  } as never;
}

test("sidebar lines fit at every supported component width", () => {
  const messages: UserMessage[] = Array.from({ length: 24 }, (_, index) => ({
    id: String(index),
    index: index + 1,
    timestamp: new Date(2026, 7, 31, 12, index).toISOString(),
    text: `Message ${index + 1} with a long path /Users/example/repository/src/component-${index}.ts and wide text 你好世界`,
  }));
  const ctx = fakeContext(messages);
  const sidebar = new SidebarComponent({
    tui: fakeTui(),
    ctx,
    messages,
    getThinkingLevel: () => "xhigh",
    getFooterData: () => ({
      getGitBranch: () => "feature/a-very-long-branch-name",
      getExtensionStatuses: () => new Map([["goal", "A long extension status that needs clipping"]]),
      getAvailableProviderCount: () => 4,
      onBranchChange: () => () => {},
    }),
  });

  for (const width of [1, 8, 16, 24, 35, SIDEBAR_WIDTH]) {
    const lines = sidebar.render(width);
    assert.ok(lines.length <= 24);
    assert.ok(lines.every((line) => visibleWidth(line) <= width), `overflow at width ${width}`);
    sidebar.invalidate();
  }
});

test("expanded messages stay bounded", () => {
  const messages = [{
    id: "1",
    index: 1,
    timestamp: new Date().toISOString(),
    text: "supercalifragilisticexpialidocious/without/any/breaks/and/with/你好世界".repeat(4),
  }];
  const sidebar = new SidebarComponent({
    tui: fakeTui(),
    ctx: fakeContext(messages),
    messages,
    getThinkingLevel: () => "high",
    getFooterData: () => null,
  });
  sidebar.setFocused(true);
  sidebar.handleInput("\r");
  const lines = sidebar.render(35);
  assert.ok(lines.every((line) => visibleWidth(line) <= 35));
});
