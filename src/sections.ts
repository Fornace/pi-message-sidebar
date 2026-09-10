import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CmuxContext } from "./cmux.ts";
import type { FileEdit } from "./files.ts";
import type { ThreadGoal } from "./goal.ts";
import { computeUsage } from "./status-dock.ts";
import {
  BG,
  BG_GOAL,
  BOLD,
  FG_BRIGHT,
  FG_ERR,
  FG_FAINT,
  FG_INFO,
  FG_PRIMARY,
  FG_RULE,
  FG_SECONDARY,
  FG_STATUS_ACTIVE,
  FG_STATUS_DONE,
  FG_STATUS_WAIT,
  RST,
  fillRow,
  ellipsizePath,
  formatCwd,
  formatCost,
  formatElapsed,
  formatTokens,
} from "./style.ts";
/**
 * Content width inside the rail: 42 columns minus the boundary and the two
 * pads. Every budget below measures against this, so a right-aligned element
 * lands one pad short of the rail edge.
 */
export const RAIL_CONTENT = 39;

/** Cells a rail row paints to the right of the boundary: pad + content + pad. */
export function railFill(width = RAIL_CONTENT): number {
  return width + 2;
}

export function railRow(content: string, bg: string, width = RAIL_CONTENT): string {
  return `${FG_RULE}│${RST}${fillRow(` ${content}`, railFill(width), bg)}`;
}

export function ruleRow(width = RAIL_CONTENT): string {
  return `${FG_RULE}│${RST}${fillRow(` ${FG_RULE}${"─".repeat(Math.max(0, width))}${RST}`, railFill(width), BG)}`;
}

function labelRow(label: string, bg: string, right?: string): string {
  if (right === undefined) return railRow(`${FG_SECONDARY}${label}${RST}`, bg);
  const leftWidth = visibleWidth(label);
  const gap = Math.max(1, RAIL_CONTENT - leftWidth - visibleWidth(right));
  return railRow(`${FG_SECONDARY}${label}${RST}${" ".repeat(gap)}${right}`, bg);
}

// --- goal -----------------------------------------------------------------

function goalStatus(goal: ThreadGoal): { icon: string; color: string; label: string } {
  switch (goal.status) {
    case "active": return { icon: "●", color: FG_STATUS_ACTIVE, label: "ACTIVE" };
    case "complete": return { icon: "✓", color: FG_STATUS_DONE, label: "COMPLETE" };
    case "paused": return { icon: "○", color: FG_STATUS_WAIT, label: "PAUSED" };
    case "budgetLimited": return { icon: "▲", color: FG_ERR, label: "BUDGET" };
  }
}

/**
 * The goal is the primary element: bold bright title, status color, explicit
 * budget and elapsed metadata, on the strongest background in the rail.
 */
export function renderGoalSection(goal: ThreadGoal | null, rows: number, width = RAIL_CONTENT): string[] {
  if (rows <= 0) return [];
  const lines: string[] = [];
  const push = (line: string) => { if (lines.length < rows) lines.push(line); };
  const bg = BG_GOAL;

  if (!goal) {
    push(railRow("", bg, width));
    push(railRow(`${BOLD}${FG_SECONDARY}GOAL${RST}`, bg, width));
    push(railRow(`${FG_FAINT}No active goal · /goal <objective>${RST}`, bg, width));
    while (lines.length < rows) push(railRow("", bg, width));
    return lines;
  }

  const status = goalStatus(goal);
  const statusText = `${status.color}${BOLD}${status.icon} ${status.label}${RST}`;
  const elapsedText = `${FG_BRIGHT}${formatElapsed(goal.usage.activeSeconds)} elapsed${RST}`;
  const overBudget = goal.tokenBudget !== null && goal.usage.tokensUsed > goal.tokenBudget;
  const budgetText = goal.tokenBudget
    ? `${overBudget ? FG_ERR : FG_BRIGHT}${formatTokens(goal.usage.tokensUsed)} / ${formatTokens(goal.tokenBudget)} tokens used${RST}`
    : `${FG_BRIGHT}${formatTokens(goal.usage.tokensUsed)} tokens used${RST} ${FG_FAINT}· unlimited${RST}`;

  const titleWrap = Math.max(1, width);
  const titleLines: string[] = [];
  const words = goal.objective.replace(/\s+/g, " ").trim().split(" ");
  let current = "";
  let wordIndex = 0;
  for (; wordIndex < words.length; wordIndex++) {
    const word = words[wordIndex]!;
    const candidate = current ? `${current} ${word}` : word;
    if (visibleWidth(candidate) > titleWrap && current) {
      titleLines.push(current);
      current = word;
      if (titleLines.length === 2) break;
    } else {
      current = candidate;
    }
  }
  if (titleLines.length < 2 && current) {
    titleLines.push(current);
    wordIndex++;
  }
  if (titleLines.length === 2 && wordIndex < words.length) {
    const rest = words.slice(wordIndex).join(" ");
    const combined = `${titleLines[1]} ${rest}`;
    titleLines[1] = truncateToWidth(combined, titleWrap, "…");
  }

  // Spacious layout: blank, label, blank, 2 title rows, blank, status, budget, blank.
  push(railRow("", bg, width));
  push(railRow(`${BOLD}${FG_SECONDARY}GOAL${RST}`, bg, width));
  if (rows >= 8) push(railRow("", bg, width));
  push(railRow(`${BOLD}${FG_BRIGHT}${truncateToWidth(titleLines[0] ?? "—", titleWrap, "…")}${RST}`, bg, width));
  if (rows >= 7) push(railRow(`${BOLD}${FG_BRIGHT}${truncateToWidth(titleLines[1] ?? "", titleWrap, "…")}${RST}`, bg, width));
  if (rows >= 9) push(railRow("", bg, width));
  // Status left, elapsed right on one row.
  const elapsedCells = visibleWidth(`${formatElapsed(goal.usage.activeSeconds)} elapsed`);
  const gap = Math.max(1, width - visibleWidth(`${status.icon} ${status.label}`) - elapsedCells);
  push(railRow(`${statusText}${" ".repeat(gap)}${elapsedText}`, bg, width));
  push(railRow(budgetText, bg, width));
  while (lines.length < rows) push(railRow("", bg, width));
  return lines;
}

// --- session --------------------------------------------------------------

export function renderSessionSection(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider | null,
  cmux: CmuxContext | null,
  rows: number,
  width = RAIL_CONTENT,
): string[] {
  if (rows <= 0) return [];
  const lines: string[] = [];
  const push = (line: string) => { if (lines.length < rows) lines.push(line); };

  push(labelRow("SESSION", BG));
  const surface = cmux?.surfaceRef ?? "surface n/a";
  const workspace = cmux?.workspaceTitle ?? cmux?.workspaceRef ?? "";
  const identityRow = workspace
    ? `${FG_INFO}${surface}${RST} ${FG_FAINT}·${RST} ${FG_PRIMARY}${truncateToWidth(workspace, Math.max(1, width - visibleWidth(surface) - 3), "…")}${RST}`
    : `${FG_INFO}${surface}${RST}`;
  push(railRow(identityRow, BG, width));
  push(railRow(`${FG_PRIMARY}${ellipsizePath(formatCwd(ctx.sessionManager.getCwd()), width)}${RST}`, BG, width));
  if (rows >= 4) {
    const branch = footerData?.getGitBranch() ?? null;
    const sessionId = ctx.sessionManager.getSessionId().replace(/-/g, "").slice(0, 8);
    const sessionPart = `${FG_FAINT}session${RST} ${FG_PRIMARY}${sessionId}${RST}`;
    if (branch) {
      const branchBudget = Math.max(1, width - visibleWidth("branch ") - 3 - visibleWidth(`session ${sessionId}`));
      push(railRow(`${FG_FAINT}branch${RST} ${FG_PRIMARY}${truncateToWidth(branch, branchBudget, "…")}${RST} ${FG_FAINT}·${RST} ${sessionPart}`, BG, width));
    } else {
      push(railRow(sessionPart, BG, width));
    }
  }
  while (lines.length < rows) push(railRow("", BG, width));
  return lines;
}

// --- files ----------------------------------------------------------------

/**
 * The session's write footprint: heading with the distinct-file count, then
 * the most recently touched files, latest first, with a repeat count when a
 * file was written more than once. Zero rows when nothing was edited.
 */
export function renderFilesSection(files: FileEdit[], rows: number, width = RAIL_CONTENT): string[] {
  if (rows <= 0 || files.length === 0) return [];
  const lines: string[] = [];
  const push = (line: string) => { if (lines.length < rows) lines.push(line); };

  const noun = files.length === 1 ? "file" : "files";
  push(labelRow("FILES", BG, `${FG_FAINT}${files.length} ${noun}${RST}`));
  for (const file of files) {
    if (lines.length >= rows) break;
    const repeats = file.edits > 1 ? ` ${FG_FAINT}×${file.edits}${RST}` : "";
    push(railRow(`${FG_PRIMARY}${ellipsizePath(file.path, Math.max(1, width - visibleWidth(repeats)))}${RST}${repeats}`, BG, width));
  }
  while (lines.length < rows) push(railRow("", BG, width));
  return lines;
}

// --- runtime --------------------------------------------------------------

export function renderRuntimeSection(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider | null,
  thinkingLevel: string,
  rows: number,
  width = RAIL_CONTENT,
): string[] {
  if (rows <= 0) return [];
  const lines: string[] = [];
  const push = (line: string) => { if (lines.length < rows) lines.push(line); };

  const model = ctx.model;
  if (model) {
    const provider = footerData && footerData.getAvailableProviderCount() > 1 ? `${model.provider}/` : "";
    push(railRow(`${FG_SECONDARY}${truncateToWidth(`${provider}${model.id}`, width, "…")}${RST}`, BG, width));
  }
  const usage = computeUsage(ctx);
  const percent = usage.contextPercent === null ? "?" : `${Math.round(usage.contextPercent)}%`;
  const thinking = model?.reasoning ? `${thinkingLevel} ${FG_FAINT}·${RST} ` : "";
  push(railRow(`${FG_SECONDARY}${thinking}ctx ${percent} ${FG_FAINT}·${RST} ${formatCost(usage.cost)}${RST}`, BG, width));
  while (lines.length < rows) push(railRow("", BG, width));
  return lines;
}
