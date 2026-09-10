import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TitleService, fallbackTitle, type UserMessage } from "../src/titles.ts";

function createTempDir(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "sidebar-titles-test-"));
  return { path: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function userMessage(id: string, text: string, index = 1): UserMessage {
  return { id, text, index, timestamp: new Date().toISOString() };
}

test("initial cadence generates title from LLM and calls onChange", async () => {
  const temp = createTempDir();
  process.env.PI_TITLES_DIR = temp.path;
  process.env.FORNACE_LLM_API_KEY = "test-key";

  let changed = false;
  const mockFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Fix Sidebar Layout Bug" } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const titles = new TitleService("sess-1", () => { changed = true; }, mockFetch);
    const msg = userMessage("m1", "Please fix the sidebar layout bug immediately");

    // Before turn completes: fallback title is served
    assert.equal(titles.get("m1", msg.text), fallbackTitle(msg.text));
    assert.equal(titles.hasModelTitle("m1"), false);

    // Turn 1 completes: triggers initial cadence
    titles.turnCompleted([msg]);

    // Wait for async drain
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(changed, true);
    assert.equal(titles.hasModelTitle("m1"), true);
    assert.equal(titles.get("m1", msg.text), "Fix Sidebar Layout Bug");
    titles.dispose();
  } finally {
    temp.cleanup();
  }
});

test("refine cadence survives in-flight request without losing work", async () => {
  const temp = createTempDir();
  process.env.PI_TITLES_DIR = temp.path;
  process.env.FORNACE_LLM_API_KEY = "test-key";

  let resolveFirst: ((val: Response) => void) | null = null;
  let calls = 0;

  const mockFetch: typeof fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Refined Sidebar Layout Title" } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const titles = new TitleService("sess-2", () => {}, mockFetch);
    const msg = userMessage("m1", "Initial request to fix the sidebar");

    // Turn 1 completes: starts initial generation (which hangs in mock)
    titles.turnCompleted([msg]);
    assert.equal(calls, 1);

    // Turn 2 completes while turn 1 generation is still in-flight:
    // This should NOT be dropped by pending-check!
    titles.turnCompleted([msg]);

    // Now resolve the first request
    resolveFirst!(new Response(JSON.stringify({
      choices: [{ message: { content: "First Title" } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    // Wait for the refine pass to be drained
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(calls, 2);
    assert.equal(titles.get("m1", msg.text), "Refined Sidebar Layout Title");
    titles.dispose();
  } finally {
    temp.cleanup();
  }
});

test("fallback and failure reporting notifies once on error and keeps fallback", async () => {
  const temp = createTempDir();
  process.env.PI_TITLES_DIR = temp.path;
  process.env.FORNACE_LLM_API_KEY = "test-key";

  const notifications: string[] = [];
  const failingFetch: typeof fetch = async () => {
    throw new Error("Network offline");
  };

  try {
    const titles = new TitleService(
      "sess-3",
      () => {},
      failingFetch,
      (err) => notifications.push(err),
    );
    const msg1 = userMessage("m1", "First failing message text");
    const msg2 = userMessage("m2", "Second failing message text");

    titles.turnCompleted([msg1]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Fallback title is preserved
    assert.equal(titles.get("m1", msg1.text), fallbackTitle(msg1.text));
    assert.equal(titles.hasModelTitle("m1"), false);
    // Notified once
    assert.equal(notifications.length, 1);
    assert.match(notifications[0]!, /Sidebar titles unavailable/);

    // Second failure in the same session does not spam notify
    titles.turnCompleted([msg1, msg2]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(notifications.length, 1);
    assert.equal(titles.get("m2", msg2.text), fallbackTitle(msg2.text));

    titles.dispose();
  } finally {
    temp.cleanup();
  }
});

test("each message is titled once, then sharpened on a later turn", async () => {
  const temp = createTempDir();
  process.env.PI_TITLES_DIR = temp.path;
  process.env.FORNACE_LLM_API_KEY = "test-key";

  const calls: string[] = [];
  const mockFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const prompt: string = body.messages[1].content;
    const id = prompt.match(/msg-\d+/)?.[0] ?? "?";
    calls.push(`${id}:${prompt.startsWith("Current title:") ? "refine" : "initial"}`);
    return new Response(JSON.stringify({ choices: [{ message: { content: `Title for ${id}` } }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const titles = new TitleService("sess-cadence", () => {}, mockFetch);
    const history: UserMessage[] = [];
    // A turn normally arrives with a new newest message. A cadence that only
    // ever inspected the newest would title everything and refine nothing.
    for (let turn = 1; turn <= 4; turn++) {
      history.push(userMessage(`id-${turn}`, `msg-${turn} please do the thing`, turn));
      titles.turnCompleted(history);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    assert.deepEqual(calls, [
      "msg-1:initial",
      "msg-2:initial", "msg-1:refine",
      "msg-3:initial", "msg-2:refine",
      "msg-4:initial", "msg-3:refine",
    ]);
    // One sharpening pass only: a refined message is not refined again.
    assert.equal(calls.filter((c) => c === "msg-1:refine").length, 1);
    titles.dispose();
  } finally {
    temp.cleanup();
  }
});

test("an unconfigured gateway stays silent while a real failure notifies", async () => {
  const temp = createTempDir();
  process.env.PI_TITLES_DIR = temp.path;
  delete process.env.FORNACE_LLM_API_KEY;

  const notifications: string[] = [];
  const unreachable: typeof fetch = async () => { throw new Error("should not be called"); };

  try {
    const titles = new TitleService("sess-unconfigured", () => {}, unreachable, (e) => notifications.push(e));
    const msg = userMessage("m1", "Some prompt text");
    titles.turnCompleted([msg]);
    await new Promise((resolve) => setTimeout(resolve, 40));

    // No key is a configuration state, not a failure worth warning about.
    assert.deepEqual(notifications, []);
    assert.equal(titles.get("m1", msg.text), fallbackTitle(msg.text));
    titles.dispose();
  } finally {
    temp.cleanup();
  }
});
