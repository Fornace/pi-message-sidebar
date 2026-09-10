import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { sanitizeStatusText } from "./style.ts";

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  latestCacheHitRate?: number;
};

export type Usage = UsageTotals & {
  contextPercent: number | null;
  contextWindow: number;
};

type UsageCache = { key: string; totals: UsageTotals };
const usageCaches = new WeakMap<ExtensionContext, UsageCache>();

/** Aggregate persisted usage once, but sample live context usage on every render. */
export function computeUsage(ctx: ExtensionContext): Usage {
  const entries = ctx.sessionManager.getEntries();
  const last = entries.at(-1);
  const key = `${entries.length}:${last?.id ?? ""}:${last?.timestamp ?? ""}`;
  let totals = usageCaches.get(ctx);

  if (!totals || totals.key !== key) {
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let cost = 0;
    let latestCacheHitRate: number | undefined;
    for (const entry of entries) {
      if (entry.type !== "message" || entry.message.role !== "assistant") continue;
      const value = (entry.message as any).usage ?? {};
      input += value.input ?? 0;
      output += value.output ?? 0;
      cacheRead += value.cacheRead ?? 0;
      cacheWrite += value.cacheWrite ?? 0;
      cost += value.cost?.total ?? 0;
      const prompt = (value.input ?? 0) + (value.cacheRead ?? 0) + (value.cacheWrite ?? 0);
      latestCacheHitRate = prompt > 0 ? ((value.cacheRead ?? 0) / prompt) * 100 : undefined;
    }
    totals = { key, totals: { input, output, cacheRead, cacheWrite, cost, latestCacheHitRate } };
    usageCaches.set(ctx, totals);
  }

  const context = ctx.getContextUsage?.();
  return {
    ...totals.totals,
    contextPercent: typeof context?.percent === "number" && Number.isFinite(context.percent)
      ? context.percent
      : null,
    contextWindow: typeof context?.contextWindow === "number" && Number.isFinite(context.contextWindow)
      ? context.contextWindow
      : ctx.model?.contextWindow ?? 0,
  };
}

export function validExtensionStatuses(footerData: ReadonlyFooterDataProvider | null): string[] {
  if (!footerData) return [];
  const statuses = footerData.getExtensionStatuses();
  if (!(statuses && typeof (statuses as any).entries === "function")) return [];
  const valid: [string, string][] = [];
  for (const entry of statuses.entries()) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "string") continue;
    const text = sanitizeStatusText(entry[1]);
    if (text) valid.push([entry[0], text]);
  }
  return valid.sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text);
}
