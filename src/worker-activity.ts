import { stripControl } from "./style.ts";

export type WorkerState = "queued" | "spawning" | "running" | "idle" | "completed" | "yielded" | "failed" | "aborted" | "paused";
export type WorkerActivity = {
  version: 1;
  sessionId: string;
  handle: string;
  agentName: string;
  state: WorkerState;
  at: number;
  task?: string;
  model?: string;
  sessionFile?: string;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; turns?: number };
  event?: { type: string; toolName?: string; path?: string; text?: string; reason?: string };
};
export type WorkerCard = WorkerActivity & {
  observed: string;
  quote: string;
  tokens: number;
  samples: { at: number; tokens: number }[];
};
const STATES = new Set(["queued", "spawning", "running", "idle", "completed", "yielded", "failed", "aborted", "paused"]);
export const plainSnippet = (text: string, cap = 180): string =>
  stripControl(text).replace(/[\r\n\t]+/g, " ").replace(/ +/g, " ").trim().slice(0, cap);

/** Observations only. No polling, summaries, inference or model control. */
export class WorkerActivityStore {
  private sessionId = "";
  private cards = new Map<string, WorkerCard>();
  reset(sessionId: string): void { this.sessionId = sessionId; this.cards.clear(); }
  accept(raw: unknown): boolean {
    if (!raw || typeof raw !== "object") throw new Error("Invalid worker activity record");
    const event = raw as WorkerActivity;
    if (event.sessionId !== this.sessionId) return false;
    if (event.version !== 1 || !STATES.has(event.state) || typeof event.handle !== "string" ||
        !Number.isFinite(event.at) || typeof event.agentName !== "string") {
      throw new Error("Invalid worker activity schema");
    }
    const prior = this.cards.get(event.handle);
    if (prior && event.at < prior.at) return false;
    let tokens = 0;
    if (event.usage) {
      for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
        const value = event.usage[key] ?? 0;
        if (!Number.isFinite(value) || value < 0) throw new Error("Invalid worker usage");
        tokens += value;
      }
    } else tokens = prior?.tokens ?? 0;
    const samples = [...(prior?.samples ?? [])];
    if (!samples.length || tokens !== prior?.tokens) samples.push({ at: event.at, tokens });
    while (samples.length > 32) samples.shift();
    let observed = prior?.observed ?? "";
    const action = event.event;
    if (action?.toolName) {
      const path = action.path ? plainSnippet(action.path).split("/").slice(-2).join("/") : "";
      observed = `${plainSnippet(action.toolName, 32)}${path ? `  ${path}` : ""}`;
    } else if (action?.type === "agent_start") observed = "model request";
    let quote = prior?.quote ?? "";
    if (typeof action?.text === "string" && action.text.trim()) quote = plainSnippet(action.text);
    this.cards.set(event.handle, { ...event, task: event.task ? plainSnippet(event.task) : prior?.task,
      observed, quote, tokens, samples });
    return true;
  }
  list(): WorkerCard[] { return [...this.cards.values()]; }
}

export const isWorking = (card: WorkerCard): boolean => card.state === "running" || card.state === "spawning";
export const needsAttention = (card: WorkerCard): boolean => card.state === "failed" || card.state === "paused";
export const isHandoff = (card: WorkerCard): boolean => card.state === "yielded";
export function visibleWorkers(cards: WorkerCard[]): WorkerCard[] {
  return cards.filter(card => isWorking(card) || needsAttention(card) || isHandoff(card) || card.state === "queued")
    .sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) ||
      Number(isHandoff(b)) - Number(isHandoff(a)) || a.handle.localeCompare(b.handle));
}
