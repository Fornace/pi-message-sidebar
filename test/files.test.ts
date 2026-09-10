import assert from "node:assert/strict";
import test from "node:test";
import { collectFileEdits } from "../src/files.ts";

function assistantEntry(calls: Array<[string, unknown]>, id = "a") {
  return {
    type: "message",
    id,
    timestamp: "2026-09-10T02:16:00Z",
    message: {
      role: "assistant",
      content: calls.map(([name, arguments_], index) => ({
        type: "toolCall",
        id: `call-${id}-${index}`,
        name,
        arguments: arguments_,
      })),
    },
  };
}

test("edit and write tool calls become distinct files, latest first", () => {
  const files = collectFileEdits([
    assistantEntry([["edit", { path: "/repo/src/old.ts" }]], "a1"),
    assistantEntry([["write", { path: "/repo/src/new.ts" }], ["edit", { path: "/repo/src/old.ts" }]], "a2"),
  ]);

  assert.deepEqual(files, [
    { path: "/repo/src/old.ts", edits: 2 },
    { path: "/repo/src/new.ts", edits: 1 },
  ]);
});

test("read-only tools, other roles, and malformed parts are skipped", () => {
  const files = collectFileEdits([
    assistantEntry([["read", { path: "/repo/src/read.ts" }], ["bash", { command: "sed -i x" }]], "a1"),
    { type: "message", id: "u", timestamp: "t", message: { role: "user", content: "edit /tmp/x" } },
    assistantEntry([["edit", { path: "" }], ["edit", {}], ["edit", { path: 42 }]], "a2"),
    { type: "compaction", id: "c" },
  ]);

  assert.deepEqual(files, []);
});

test("fast_write counts as a file edit", () => {
  const files = collectFileEdits([
    assistantEntry([["fast_write", { path: "/repo/docs/guide.md", content: "x" }]], "a1"),
  ]);

  assert.deepEqual(files, [{ path: "/repo/docs/guide.md", edits: 1 }]);
});
