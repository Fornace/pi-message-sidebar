import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readSessionGoal, type ThreadGoal } from "./goal.ts";
import type { CmuxContext } from "./cmux.ts";
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
} from "./style.ts";

type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  latestCacheHitRate?: number;
  contextPercent: number | null;
  contextWindow: number;
};

type UsageCache = { owner: object; key: string; usage: Usage };
let usageCache: UsageCache | null = null;

function computeUsage(ctx: ExtensionContext): Usage {
  const entries = ctx.sessionManager.getEntries();
  const last = entries.at(-1);
  const key = `${entries.length}:${last?.id ?? ""}`;
  if (usageCache?.owner === ctx && usageCache.key === key) return usageCache.usage;

  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let latestCacheHitRate: number | undefined;
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const usage = (entry.message as any).usage ?? {};
    input += usage.input ?? 0;
    output += usage.output ?? 0;
    cacheRead += usage.cacheRead ?? 0;
    cacheWrite += usage.cacheWrite ?? 0;
    cost += usage.cost?.total ?? 0;
    const prompt = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    latestCacheHitRate = prompt > 0 ? ((usage.cacheRead ?? 0) / prompt) * 100 : undefined;
  }

  const context = ctx.getContextUsage?.();
  const usage = {
    input,
    output,
    cacheRead,
    cacheWrite,
    cost,
    latestCacheHitRate,
    contextPercent: context?.percent ?? null,
    contextWindow: context?.contextWindow ?? ctx.model?.contextWindow ?? 0,
  };
  usageCache = { owner: ctx, key, usage };
  return usage;
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
  const objective = truncateToWidth(goal.objective.replace(/\s+/g, " ").trim(), Math.max(0, width - 4), "…");
  const budget = goal.tokenBudget
    ? `${formatTokens(goal.tokensUsed)}/${formatTokens(goal.tokenBudget)}`
    : `${formatTokens(goal.tokensUsed)}/∞`;
  const overBudget = goal.tokenBudget !== null && goal.tokensUsed > goal.tokenBudget;
  return [
    row(width, `${status.color}${status.icon}${RST}`, `${FG_BRIGHT}${objective}${RST}`),
    row(width, "goal", `${overBudget ? FG_ERR : status.color}${budget}${RST} ${FG_FAINT}·${RST} ${FG_MID}${status.label} ${formatDuration(goal.activeSeconds)}${RST}`),
  ];
}

function renderContextRow(width: number, usage: Usage): string {
  const percent = usage.contextPercent === null ? "?" : `${usage.contextPercent.toFixed(0)}%`;
  const parts = [
    `${contextColor(usage.contextPercent)}${percent}${RST}/${formatTokens(usage.contextWindow)}`,
    usage.input ? `↑${formatTokens(usage.input)}` : undefined,
    usage.output ? `↓${formatTokens(usage.output)}` : undefined,
    usage.cacheRead ? `R${formatTokens(usage.cacheRead)}` : undefined,
    usage.latestCacheHitRate !== undefined && (usage.cacheRead || usage.cacheWrite)
      ? `CH${usage.latestCacheHitRate.toFixed(0)}%`
      : undefined,
    `$${usage.cost.toFixed(3)}`,
  ].filter(Boolean).join(` ${FG_FAINT}·${RST} `);
  return row(width, "ctx", `${FG_MID}${parts}${RST}`);
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

function renderSession(width: number, ctx: ExtensionContext, cmux: CmuxContext | null): string {
  if (cmux) {
    const workspace = cmux.workspaceTitle ?? cmux.workspaceRef ?? "cmux";
    const surface = cmux.surfaceRef ? ` ${FG_FAINT}· ${cmux.surfaceRef}${RST}` : "";
    return row(width, "cmux", `${FG_BRIGHT}${workspace}${RST}${surface}`);
  }
  const shortId = ctx.sessionManager.getSessionId().replace(/-/g, "").slice(-8);
  return row(width, "sess", `${FG_INFO}#${shortId}${RST}`);
}

export function renderStatusDock(
  width: number,
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider | null,
  thinkingLevel: string,
  focused: boolean,
  getCmuxContext: () => CmuxContext | null,
  maxRows = Number.MAX_SAFE_INTEGER,
): string[] {
  if (maxRows <= 0) return [];
  const rowLimit = Math.max(1, Math.floor(maxRows));
  const usage = computeUsage(ctx);
  const goal = readSessionGoal(ctx);
  const rows: string[] = [];
  if (goal) rows.push(...renderGoal(width, goal));
  rows.push(renderWorkspace(width, ctx, footerData));
  rows.push(renderSession(width, ctx, getCmuxContext()));

  const model = ctx.model;
  if (model) {
    const provider = footerData && footerData.getAvailableProviderCount() > 1 ? `${model.provider}/` : "";
    const thinking = model.reasoning ? ` ${FG_FAINT}·${RST} ${FG_MID}${thinkingLevel}${RST}` : "";
    rows.push(row(width, "model", `${FG_BRIGHT}${provider}${model.id}${RST}${thinking}`));
  }
  rows.push(renderContextRow(width, usage));

  const statuses = footerData ? [...footerData.getExtensionStatuses().entries()].sort(([a], [b]) => a.localeCompare(b)) : [];
  if (statuses[0]) rows.push(row(width, "stat", `${FG_INFO}•${RST} ${FG_MID}${sanitizeStatusText(statuses[0][1])}${RST}`));

  const hint = focused ? "↑↓ navigate  Enter expand  c copy  Esc done" : "Ctrl+Shift+H focus";
  rows.push(fillRow(` ${FG_DIM}${hint}${RST}`, width, BG_HDR));
  if (rows.length <= rowLimit) return rows;
  if (rowLimit === 1) return [rows.at(-1)!];
  return [...rows.slice(0, rowLimit - 1), rows.at(-1)!];
}
