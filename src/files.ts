import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** One distinct file the session wrote to, with its edit count. */
export type FileEdit = { path: string; edits: number };

/** Tools whose primary effect is writing a file path. */
const WRITE_TOOLS = new Set(["edit", "write", "fast_write"]);

type BranchEntry = { type?: string; id?: string; timestamp?: string; message?: { role?: string; content?: unknown } };

/**
 * Distinct files written by the session's edit/write tool calls, most
 * recently touched first. Read-only tools and every other shape are skipped.
 */
export function collectFileEdits(entries: Iterable<BranchEntry>): FileEdit[] {
  const touched = new Map<string, { edits: number; last: number }>();
  let sequence = 0;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (!message || message.role !== "assistant") continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "toolCall") continue;
      const call = part as { name?: unknown; arguments?: unknown };
      if (typeof call.name !== "string" || !WRITE_TOOLS.has(call.name)) continue;
      const path = (call.arguments as { path?: unknown } | null | undefined)?.path;
      if (typeof path !== "string" || !path) continue;
      const record = touched.get(path);
      if (record) {
        record.edits++;
        record.last = sequence;
      } else {
        touched.set(path, { edits: 1, last: sequence });
      }
      sequence++;
    }
  }
  return [...touched.entries()]
    .sort(([, a], [, b]) => b.last - a.last)
    .map(([path, record]) => ({ path, edits: record.edits }));
}

type FileEditCache = { key: string; files: FileEdit[] };
const caches = new WeakMap<ExtensionContext, FileEditCache>();

/** Cached per extension context, like the goal reconstruction. */
export function readSessionFileEdits(ctx: ExtensionContext): FileEdit[] {
  const branch = ctx.sessionManager.getBranch();
  const last = branch.at(-1);
  const key = `${branch.length}:${last?.id ?? ""}:${last?.timestamp ?? ""}`;
  const previous = caches.get(ctx);
  if (previous?.key === key) return previous.files;
  const files = collectFileEdits(branch);
  caches.set(ctx, { key, files });
  return files;
}
