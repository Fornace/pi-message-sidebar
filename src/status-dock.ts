import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CmuxContext } from "./cmux.ts";
import { readSessionGoal, type ThreadGoal } from "./goal.ts";
import {
  BG,
  BG_HDR,
  FG_ACC,
  FG_BRIGHT,
  FG_DIM,
  FG_ERR,
  FG_FAINT,
  FG_INFO,
  FG_MID,
  FG_OK,
  FG_WARN,
  RST,
  contextColor,
  fillRow,
  formatCwd,
  formatDuration,
  formatTokens,
  sanitizeStatusText,
  wrapText,
} from "./style.ts";

type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  latestCacheHitRate?: number;
};

type Usage = UsageTotals & {
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

function row(width: number, label: string, value: string, background = BG): string {
  const prefix = ` ${FG_FAINT}${label}${RST} `;
  return fillRow(`${prefix}${truncateToWidth(value, Math.max(0, width - visibleWidth(prefix)), "…")}`, width, background);
}

function goalStatus(goal: ThreadGoal): { icon: string; color: string; label: string } {
  switch (goal.status) {
    case "active": return { icon: "●", color: FG_ACC, label: "active" };
    case "paused": return { icon: "○", color: FG_DIM, label: "paused" };
    case "budgetLimited": return { icon: "▲", color: FG_WARN, label: "budget" };
    case "complete": return { icon: "✓", color: FG_OK, label: "done" };
  }
}

function renderGoal(width: number, goal: ThreadGoal): string[] {
  const status = goalStatus(goal);
  const budget = goal.tokenBudget
    ? `${formatTokens(goal.usage.tokensUsed)}/${formatTokens(goal.tokenBudget)}`
    : `${formatTokens(goal.usage.tokensUsed)}`;
  const overBudget = goal.tokenBudget !== null && goal.usage.tokensUsed > goal.tokenBudget;
  const metadata = `${status.color}${status.icon} ${status.label}${RST} ${overBudget ? FG_ERR : FG_MID}${budget}${RST} ${FG_FAINT}${formatDuration(goal.usage.activeSeconds)}${RST}`;
  const objective = wrapText(goal.objective, Math.max(1, width - 4));
  const lines = [fillRow(` ${metadata}`, width, BG)];
  if (objective[0]) lines.push(fillRow(`   ${FG_BRIGHT}${objective[0]}${RST}`, width, BG));
  return lines;
}

function renderWorkspace(width: number, ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider | null): string {
  const branch = footerData?.getGitBranch();
  const sessionName = ctx.sessionManager.getSessionName();
  const parts = [
    `${FG_BRIGHT}${formatCwd(ctx.sessionManager.getCwd())}${RST}`,
    branch ? `${FG_INFO}${branch}${RST}` : undefined,
    sessionName ? `${FG_MID}${sessionName}${RST}` : undefined,
  ].filter(Boolean).join(` ${FG_FAINT}·${RST} `);
  return row(width, "cwd", parts);
}

function renderCmux(width: number, cmux: CmuxContext): string {
  const prefix = ` ${FG_FAINT}cmux${RST} `;
  const available = Math.max(0, width - visibleWidth(prefix));
  const surfaceText = cmux.surfaceRef ?? "";
  const surface = truncateToWidth(surfaceText, available, "");
  const separator = surface ? ` ${FG_FAINT}·${RST} ` : "";
  const titleBudget = Math.max(0, available - visibleWidth(separator) - visibleWidth(surface));
  const titleText = cmux.workspaceTitle ?? cmux.workspaceRef ?? "cmux";
  const title = truncateToWidth(titleText, titleBudget, "…");
  return fillRow(`${prefix}${FG_BRIGHT}${title}${RST}${separator}${FG_INFO}${surface}${RST}`, width, BG);
}

function renderRuntime(width: number, ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider | null, thinkingLevel: string, usage: Usage): string | null {
  const model = ctx.model;
  if (!model) return null;
  const provider = footerData && footerData.getAvailableProviderCount() > 1 ? `${model.provider}/` : "";
  const thinking = model.reasoning ? ` ${FG_FAINT}·${RST} ${FG_MID}${thinkingLevel}${RST}` : "";
  const percent = usage.contextPercent === null ? "?" : `${usage.contextPercent.toFixed(0)}%`;
  const context = `${contextColor(usage.contextPercent)}${percent}/${formatTokens(usage.contextWindow)}${RST}`;
  return row(width, "run", `${FG_BRIGHT}${provider}${model.id}${RST}${thinking} ${FG_FAINT}·${RST} ${context}`);
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

export function renderStatusDock(
  width: number,
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider | null,
  thinkingLevel: string,
  focused: boolean,
  getCmuxContext: () => CmuxContext | null,
  maxRows = 4,
): string[] {
  const limit = Math.max(0, Math.min(4, Math.floor(maxRows)));
  if (limit === 0) return [];
  const hint = fillRow(
    ` ${FG_DIM}${focused ? "↑↓ move  Enter open  c copy  Esc close" : "Ctrl+Shift+H focus"}${RST}`,
    width,
    BG_HDR,
  );
  if (limit === 1) return [hint];

  const usage = computeUsage(ctx);
  const goal = readSessionGoal(ctx);
  const cmux = getCmuxContext();
  const rows: string[] = [];

  // A cmux surface reference is operational identity. Keep it ahead of optional
  // title, runtime, and status text so truncation cannot discard it.
  if (cmux) rows.push(renderCmux(width, cmux));
  if (goal) rows.push(...renderGoal(width, goal));
  if (!cmux && !goal) rows.push(renderWorkspace(width, ctx, footerData));
  const runtime = renderRuntime(width, ctx, footerData, thinkingLevel, usage);
  if (runtime) rows.push(runtime);
  if (!goal) {
    const status = validExtensionStatuses(footerData)[0];
    if (status) rows.push(row(width, "stat", `${FG_MID}${status}${RST}`));
  }

  return [...rows.slice(0, limit - 1), hint];
}
