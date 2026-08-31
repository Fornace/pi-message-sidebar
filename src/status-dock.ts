import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  BG,
  BG_CARD,
  BG_HDR,
  FG_BRIGHT,
  FG_DIM,
  FG_FAINT,
  FG_INFO,
  FG_MID,
  RST,
  contextColor,
  fillRow,
  formatCwd,
  formatTokens,
  progressBar,
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

function computeUsage(ctx: ExtensionContext): Usage {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let latestCacheHitRate: number | undefined;

  for (const entry of ctx.sessionManager.getEntries()) {
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
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    cost,
    latestCacheHitRate,
    contextPercent: context?.percent ?? null,
    contextWindow: context?.contextWindow ?? ctx.model?.contextWindow ?? 0,
  };
}

function dockHeader(width: number, title: string): string {
  const pad = " ";
  const ruleWidth = Math.max(0, width - visibleWidth(pad) - visibleWidth(title) - 1);
  return fillRow(`${pad}${FG_FAINT}${title}${RST} ${FG_FAINT}${"─".repeat(ruleWidth)}${RST}`, width, BG);
}

function dockRow(width: number, label: string, value: string): string {
  const pad = " ";
  const labelWidth = 5;
  const maxValueWidth = Math.max(0, width - visibleWidth(pad) - labelWidth - 1);
  const clipped = truncateToWidth(value, maxValueWidth, "…");
  return fillRow(`${pad}${FG_FAINT}${label.padEnd(labelWidth)}${RST} ${clipped}`, width, BG_CARD);
}

export function renderStatusDock(
  width: number,
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider | null,
  thinkingLevel: string,
  focused: boolean,
): string[] {
  const usage = computeUsage(ctx);
  const rows = [fillRow(" ", width, BG), dockHeader(width, "runtime")];
  const branch = footerData?.getGitBranch();
  const sessionName = ctx.sessionManager.getSessionName();
  const workspace = [
    `${FG_BRIGHT}${formatCwd(ctx.sessionManager.getCwd())}${RST}`,
    branch ? `${FG_INFO}${branch}${RST}` : undefined,
    sessionName ? `${FG_MID}${sessionName}${RST}` : undefined,
  ].filter(Boolean).join(` ${FG_FAINT}•${RST} `);
  rows.push(dockRow(width, "cwd", workspace));

  const sessionId = ctx.sessionManager.getSessionId();
  const sessionFile = ctx.sessionManager.getSessionFile();
  const shortId = sessionId.replace(/-/g, "").slice(-8);
  rows.push(dockRow(width, "sess", [
    `${FG_INFO}#${shortId}${RST}`,
    sessionFile ? `${FG_FAINT}${basename(sessionFile)}${RST}` : undefined,
  ].filter(Boolean).join(` ${FG_FAINT}•${RST} `)));

  const model = ctx.model;
  if (model) {
    const provider = footerData && footerData.getAvailableProviderCount() > 1
      ? `${FG_FAINT}${model.provider}${RST} `
      : "";
    const thinking = model.reasoning ? ` ${FG_FAINT}•${RST} ${FG_MID}${thinkingLevel}${RST}` : "";
    rows.push(dockRow(width, "model", `${provider}${FG_BRIGHT}${model.id}${RST}${thinking}`));
  }

  const contextDisplay = usage.contextPercent === null
    ? `?/${formatTokens(usage.contextWindow)}`
    : `${usage.contextPercent.toFixed(1)}%/${formatTokens(usage.contextWindow)}`;
  const usingSubscription = model ? Boolean((ctx.modelRegistry as any).isUsingOAuth?.(model)) : false;
  const tokenParts = [
    usage.input ? `↑${formatTokens(usage.input)}` : undefined,
    usage.output ? `↓${formatTokens(usage.output)}` : undefined,
    usage.cacheRead ? `R${formatTokens(usage.cacheRead)}` : undefined,
    usage.cacheWrite ? `W${formatTokens(usage.cacheWrite)}` : undefined,
    usage.latestCacheHitRate !== undefined && (usage.cacheRead || usage.cacheWrite)
      ? `CH${usage.latestCacheHitRate.toFixed(1)}%`
      : undefined,
  ].filter(Boolean).join(" ");
  rows.push(dockRow(
    width,
    "ctx",
    `${contextColor(usage.contextPercent)}${contextDisplay}${RST} ${progressBar(usage.contextPercent)}`,
  ));
  rows.push(dockRow(
    width,
    "use",
    `${FG_BRIGHT}$${usage.cost.toFixed(3)}${usingSubscription ? " sub" : ""}${RST}` +
      (tokenParts ? ` ${FG_FAINT}•${RST} ${FG_MID}${tokenParts}${RST}` : ` ${FG_FAINT}• no token usage${RST}`),
  ));

  const statuses = footerData ? [...footerData.getExtensionStatuses().entries()].sort(([a], [b]) => a.localeCompare(b)) : [];
  for (const [, text] of statuses.slice(0, 2)) {
    rows.push(dockRow(width, "stat", `${FG_INFO}•${RST} ${FG_MID}${sanitizeStatusText(text)}${RST}`));
  }

  rows.push(fillRow(" ", width, BG));
  const hint = focused
    ? `${FG_DIM}↑↓${RST} ${FG_MID}nav${RST} ${FG_FAINT}·${RST} ${FG_DIM}Enter${RST} ${FG_MID}expand${RST} ${FG_FAINT}·${RST} ${FG_DIM}c${RST} ${FG_MID}copy${RST} ${FG_FAINT}·${RST} ${FG_DIM}Esc${RST} ${FG_MID}done${RST}`
    : `${FG_DIM}Ctrl+Shift+H${RST} ${FG_MID}focus${RST}`;
  rows.push(fillRow(` ${hint}`, width, BG_HDR));
  return rows;
}
