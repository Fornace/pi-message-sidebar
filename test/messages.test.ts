import assert from "node:assert/strict";
import test from "node:test";
import { collectUserMessages } from "../message-sidebar.ts";

function contextWith(entries: unknown[]) {
  return { sessionManager: { getBranch: () => entries } } as never;
}

function userEntry(id: string, content: unknown, timestamp = "2026-09-10T02:16:00Z") {
  return { type: "message", id, timestamp, message: { role: "user", content } };
}

test("user text is read from both plain and structured content", () => {
  const messages = collectUserMessages(contextWith([
    userEntry("a", "plain string"),
    userEntry("b", [{ type: "text", text: "first" }, { type: "text", text: "second" }]),
  ]));

  assert.deepEqual(messages.map((m) => m.text), ["plain string", "first second"]);
});

test("non-text content parts and non-user entries are skipped", () => {
  const messages = collectUserMessages(contextWith([
    { type: "message", id: "assistant", timestamp: "t", message: { role: "assistant", content: "reply" } },
    { type: "custom", customType: "pi-codex-goal", id: "goal", timestamp: "t", data: {} },
    userEntry("mixed", [{ type: "image", url: "x" }, { type: "text", text: "caption" }]),
  ]));

  assert.deepEqual(messages.map((m) => m.id), ["mixed"]);
  assert.equal(messages[0]!.text, "caption");
});

test("ordinals stay contiguous when an untitled user turn is skipped", () => {
  const messages = collectUserMessages(contextWith([
    userEntry("first", "one"),
    userEntry("image-only", [{ type: "image", url: "x" }]),
    userEntry("blank", "   "),
    userEntry("second", "two"),
  ]));

  // The detail header renders "#index"; it must agree with the heading's
  // "position/total", which counts only the messages actually shown.
  assert.deepEqual(messages.map((m) => m.id), ["first", "second"]);
  assert.deepEqual(messages.map((m) => m.index), [1, 2]);
});

test("entry id and timestamp are carried through for selection and the detail header", () => {
  const messages = collectUserMessages(contextWith([userEntry("entry-7", "text", "2026-09-10T09:30:00Z")]));

  assert.equal(messages[0]!.id, "entry-7");
  assert.equal(messages[0]!.timestamp, "2026-09-10T09:30:00Z");
});

test("pasted escape sequences are stripped at the collection boundary", () => {
  const messages = collectUserMessages(contextWith([
    userEntry("ansi", "before \u001b[41mRED BG\u001b[0m mid \u001b]0;evil title\u0007 after"),
  ]));

  assert.equal(messages.length, 1);
  assert.ok(!messages[0]!.text.includes("\u001b"), "no escape may reach the rail");
  assert.match(messages[0]!.text, /before RED BG mid  after/);
});
