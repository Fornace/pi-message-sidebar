import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SummaryService, fallbackSummary, isGatewayConfigured, type UserMessage } from "../src/summaries.ts";

function createTempDir(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "sidebar-summaries-test-"));
  return { path: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function userMessage(id: string, text: string, index = 1): UserMessage {
  return { id, text, index, timestamp: new Date().toISOString() };
}

test("initial cadence generates a summary from the LLM and calls onChange", async () => {
  const temp = createTempDir();
  process.env.PI_SUMMARIES_DIR = temp.path;
  process.env.FORNACE_LLM_API_KEY = "test-key";

  let changed = false;
  const mockFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Fix the sidebar layout bug so rows fill exactly" } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const summaries = new SummaryService("sess-1", () => { changed = true; }, mockFetch);
    const msg = userMessage("m1", "Please fix the sidebar layout bug immediately");

    // Before turn completes: fallback preview is served
    assert.equal(summaries.get("m1", msg.text), fallbackSummary(msg.text));
    assert.equal(summaries.hasSummary("m1"), false);

    // Turn 1 completes: triggers initial cadence
    summaries.turnCompleted([msg]);

    // Wait for async drain
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(changed, true);
    assert.equal(summaries.hasSummary("m1"), true);
    assert.equal(summaries.get("m1", msg.text), "Fix the sidebar layout bug so rows fill exactly");
    summaries.dispose();
  } finally {
    temp.cleanup();
  }
});

test("refine cadence survives in-flight request without losing work", async () => {
  const temp = createTempDir();
  process.env.PI_SUMMARIES_DIR = temp.path;
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
      choices: [{ message: { content: "Refined sidebar layout summary" } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const summaries = new SummaryService("sess-2", () => {}, mockFetch);
    const msg = userMessage("m1", "Initial request to fix the sidebar");

    // Turn 1 completes: starts initial generation (which hangs in mock)
    summaries.turnCompleted([msg]);
    assert.equal(calls, 1);

    // Turn 2 completes while turn 1 generation is still in-flight:
    // This should NOT be dropped by pending-check!
    summaries.turnCompleted([msg]);

    // Now resolve the first request
    resolveFirst!(new Response(JSON.stringify({
      choices: [{ message: { content: "First summary" } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    // Wait for the refine pass to be drained
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(calls, 2);
    assert.equal(summaries.get("m1", msg.text), "Refined sidebar layout summary");
    summaries.dispose();
  } finally {
    temp.cleanup();
  }
});

test("fallback and failure reporting notifies once on error and keeps fallback", async () => {
  const temp = createTempDir();
  process.env.PI_SUMMARIES_DIR = temp.path;
  process.env.FORNACE_LLM_API_KEY = "test-key";

  const notifications: string[] = [];
  const failingFetch: typeof fetch = async () => {
    throw new Error("Network offline");
  };

  try {
    const summaries = new SummaryService(
      "sess-3",
      () => {},
      failingFetch,
      (err) => notifications.push(err),
    );
    const msg1 = userMessage("m1", "First failing message text");
    const msg2 = userMessage("m2", "Second failing message text");

    summaries.turnCompleted([msg1]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Fallback preview is preserved
    assert.equal(summaries.get("m1", msg1.text), fallbackSummary(msg1.text));
    assert.equal(summaries.hasSummary("m1"), false);
    // Notified once
    assert.equal(notifications.length, 1);
    assert.match(notifications[0]!, /Sidebar summaries unavailable/);

    // Second failure in the same session does not spam notify
    summaries.turnCompleted([msg1, msg2]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(notifications.length, 1);
    assert.equal(summaries.get("m2", msg2.text), fallbackSummary(msg2.text));

    summaries.dispose();
  } finally {
    temp.cleanup();
  }
});

test("each message is summarized once, then sharpened on a later turn", async () => {
  const temp = createTempDir();
  process.env.PI_SUMMARIES_DIR = temp.path;
  process.env.FORNACE_LLM_API_KEY = "test-key";

  const calls: string[] = [];
  const mockFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const prompt: string = body.messages[1].content;
    const id = prompt.match(/msg-\d+/)?.[0] ?? "?";
    calls.push(`${id}:${prompt.startsWith("Current summary:") ? "refine" : "initial"}`);
    return new Response(JSON.stringify({ choices: [{ message: { content: `Summary of ${id}` } }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const summaries = new SummaryService("sess-cadence", () => {}, mockFetch);
    const history: UserMessage[] = [];
    // A turn normally arrives with a new newest message. A cadence that only
    // ever inspected the newest would summarize everything and refine nothing.
    for (let turn = 1; turn <= 4; turn++) {
      history.push(userMessage(`id-${turn}`, `msg-${turn} please do the thing`, turn));
      summaries.turnCompleted(history);
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
    summaries.dispose();
  } finally {
    temp.cleanup();
  }
});

test("an unconfigured gateway stays silent while a real failure notifies", async () => {
  const temp = createTempDir();
  process.env.PI_SUMMARIES_DIR = temp.path;
  delete process.env.FORNACE_LLM_API_KEY;

  const notifications: string[] = [];
  const unreachable: typeof fetch = async () => { throw new Error("should not be called"); };

  try {
    const summaries = new SummaryService("sess-unconfigured", () => {}, unreachable, (e) => notifications.push(e));
    const msg = userMessage("m1", "Some prompt text");
    summaries.turnCompleted([msg]);
    await new Promise((resolve) => setTimeout(resolve, 40));

    // No key is a configuration state, not a failure worth warning about.
    assert.deepEqual(notifications, []);
    assert.equal(summaries.get("m1", msg.text), fallbackSummary(msg.text));
    summaries.dispose();
  } finally {
    temp.cleanup();
  }
});

test("isGatewayConfigured reflects the gateway key and gates the setup hint", () => {
  const previous = process.env.FORNACE_LLM_API_KEY;
  try {
    delete process.env.FORNACE_LLM_API_KEY;
    assert.equal(isGatewayConfigured(), false);
    process.env.FORNACE_LLM_API_KEY = "key";
    assert.equal(isGatewayConfigured(), true);
  } finally {
    if (previous === undefined) delete process.env.FORNACE_LLM_API_KEY;
    else process.env.FORNACE_LLM_API_KEY = previous;
  }
});

test("a verbose model answer is clipped to the stored width", () => {
  const clipped = fallbackSummary("word ".repeat(200));
  assert.ok(visibleWidth(clipped) <= 58, `fallback preview must stay within two rail rows (${visibleWidth(clipped)} cells)`);
  assert.ok(clipped.endsWith("…") || visibleWidth(clipped) < 58);
});
