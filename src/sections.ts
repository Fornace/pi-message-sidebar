import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CmuxContext } from "./cmux.ts";
import type { FileEdit } from "./files.ts";
import type { ThreadGoal } from "./goal.ts";
import type { Palette } from "./palette.ts";
import { computeUsage } from "./status-dock.ts";
import {
  RST,
  clip,
  ellipsizePath,
  formatCost,
  formatCwd,
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

export function railRow(palette: Palette, content: string, bg: string, width = RAIL_CONTENT): string {
  const injected = content.replace(/\x1b\[0m/g, `${RST}${bg}`);
  const pad = " ".repeat(Math.max(0, width + 1 - visibleWidth(injected)));
  return `${palette.rule}│${RST}${bg} ${injected}${pad}${RST}`;
}

export function ruleRow(palette: Palette, width = RAIL_CONTENT): string {
  return railRow(palette, `${palette.rule}${"─".repeat(Math.max(0, width))}${RST}`, palette.bgBase, width);
}

function labelRow(palette: Palette, label: string, bg: string, right?: string): string {
  if (right === undefined) return railRow(palette, `${palette.label}${label}${RST}`, bg);
  const gap = Math.max(1, RAIL_CONTENT - visibleWidth(label) - visibleWidth(right));
  return railRow(palette, `${palette.label}${label}${RST}${" ".repeat(gap)}${right}`, bg);
}

// --- goal -----------------------------------------------------------------

function goalStatus(palette: Palette, goal: ThreadGoal): { icon: string; color: string; label: string } {
  switch (goal.status) {
    case "active": return { icon: "●", color: palette.badgeAdded, label: "ACTIVE" };
    case "complete": return { icon: "✓", color: palette.badgeAdded, label: "COMPLETE" };
    case "paused": return { icon: "○", color: palette.badgeModified, label: "PAUSED" };
    case "budgetLimited": return { icon: "▲", color: palette.badgeDeleted, label: "BUDGET" };
  }
}

/**
 * The goal is the primary element: bold title, status color, explicit budget
 * and elapsed metadata, on the raised step of the background ladder.
 */
export function renderGoalSection(goal: ThreadGoal | null, rows: number, palette: Palette, width = RAIL_CONTENT): string[] {
  if (rows <= 0) return [];
  const lines: string[] = [];
  const push = (line: string) => { if (lines.length < rows) lines.push(line); };
  const bg = palette.bgRaised;

  if (!goal) {
    push(railRow(palette, "", bg, width));
    push(railRow(palette, `${palette.label}GOAL${RST}`, bg, width));
    push(railRow(palette, `${palette.meta}No active goal · /goal <objective>${RST}`, bg, width));
    while (lines.length < rows) push(railRow(palette, "", bg, width));
    return lines;
  }

  const status = goalStatus(palette, goal);
  const statusText = `${status.color}${palette.bold(`${status.icon} ${status.label}`)}${RST}`;
  const elapsedText = `${palette.textMid}${formatElapsed(goal.usage.activeSeconds)} elapsed${RST}`;
  const overBudget = goal.tokenBudget !== null && goal.usage.tokensUsed > goal.tokenBudget;
  const budgetText = goal.tokenBudget
    ? `${overBudget ? palette.badgeDeleted : palette.textMid}${formatTokens(goal.usage.tokensUsed)} / ${formatTokens(goal.tokenBudget)} tokens used${RST}`
    : `${palette.textMid}${formatTokens(goal.usage.tokensUsed)} tokens used${RST} ${palette.meta}· unlimited${RST}`;

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
    titleLines[1] = clip(`${titleLines[1]} ${rest}`, titleWrap);
  }

  // Spacious layout: blank, label, blank, 2 title rows, blank, status, budget, blank.
  push(railRow(palette, "", bg, width));
  push(railRow(palette, `${palette.label}GOAL${RST}`, bg, width));
  if (rows >= 8) push(railRow(palette, "", bg, width));
  push(railRow(palette, `${palette.bold(`${palette.textNew}${clip(titleLines[0] ?? "—", titleWrap)}${RST}`)}`, bg, width));
  if (rows >= 7) push(railRow(palette, `${palette.bold(`${palette.textNew}${clip(titleLines[1] ?? "", titleWrap)}${RST}`)}`, bg, width));
  if (rows >= 9) push(railRow(palette, "", bg, width));
  // Status left, elapsed right on one row.
  const elapsedCells = visibleWidth(`${formatElapsed(goal.usage.activeSeconds)} elapsed`);
  const gap = Math.max(1, width - visibleWidth(`${status.icon} ${status.label}`) - elapsedCells);
  push(railRow(palette, `${statusText}${" ".repeat(gap)}${elapsedText}`, bg, width));
  push(railRow(palette, budgetText, bg, width));
  while (lines.length < rows) push(railRow(palette, "", bg, width));
  return lines;
}

// --- session and files ------------------------------------------------------

function fileBadge(palette: Palette, letter: string | null): string {
  switch (letter) {
    case "M": return `${palette.badgeModified}M${RST}`;
    case "A": return `${palette.badgeAdded}A${RST}`;
    case "U": return `${palette.badgeAdded}U${RST}`;
    case "D": return `${palette.badgeDeleted}D${RST}`;
    case "R": return `${palette.badgeRenamed}R${RST}`;
    default: return `${palette.meta}·${RST}`;
  }
}

/**
 * Session identity plus the write footprint in one block: surface and
 * workspace, cwd, branch and session id, then a FILES subsection whose
 * heading counts distinct files and whose rows carry the git letter
 * convention (M/A/U/D/R) in front of front-trimmed paths.
 */
export function renderSessionSection(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider | null,
  cmux: CmuxContext | null,
  rows: number,
  palette: Palette,
  files: FileEdit[],
  statusFor: (path: string) => string | null,
  width = RAIL_CONTENT,
): string[] {
  if (rows <= 0) return [];
  const lines: string[] = [];
  const push = (line: string) => { if (lines.length < rows) lines.push(line); };
  const bg = palette.bgBase;

  push(labelRow(palette, "SESSION", bg));
  const surface = cmux?.surfaceRef ?? "surface n/a";
  const workspace = cmux?.workspaceTitle ?? cmux?.workspaceRef ?? "";
  const identityRow = workspace
    ? `${palette.surface}${surface}${RST} ${palette.meta}·${RST} ${palette.textMid}${clip(workspace, Math.max(1, width - visibleWidth(surface) - 3))}${RST}`
    : `${palette.surface}${surface}${RST}`;
  push(railRow(palette, identityRow, bg, width));
  push(railRow(palette, `${palette.textMid}${ellipsizePath(formatCwd(ctx.sessionManager.getCwd()), width)}${RST}`, bg, width));
  if (rows >= 4) {
    const branch = footerData?.getGitBranch() ?? null;
    const sessionId = ctx.sessionManager.getSessionId().replace(/-/g, "").slice(0, 8);
    const sessionPart = `${palette.meta}session${RST} ${palette.textMid}${sessionId}${RST}`;
    if (branch) {
      const branchBudget = Math.max(1, width - visibleWidth("branch ") - 3 - visibleWidth(`session ${sessionId}`));
      push(railRow(palette, `${palette.meta}branch${RST} ${palette.textMid}${clip(branch, branchBudget)}${RST} ${palette.meta}·${RST} ${sessionPart}`, bg, width));
    } else {
      push(railRow(palette, sessionPart, bg, width));
    }
  }
  // The FILES subsection needs its heading plus at least one file row.
  if (files.length > 0 && rows - lines.length >= 2) {
    const noun = files.length === 1 ? "file" : "files";
    push(labelRow(palette, "FILES", bg, `${palette.meta}${files.length} ${noun}${RST}`));
    for (const file of files) {
      if (lines.length >= rows) break;
      const badge = fileBadge(palette, statusFor(file.path));
      const repeats = file.edits > 1 ? `${palette.meta} ×${file.edits}${RST}` : "";
      const pathBudget = width - 2 - visibleWidth(repeats);
      push(railRow(palette, `${badge} ${palette.textMid}${ellipsizePath(file.path, Math.max(1, pathBudget))}${RST}${repeats}`, bg, width));
    }
  }
  while (lines.length < rows) push(railRow(palette, "", bg, width));
  return lines;
}

// --- runtime --------------------------------------------------------------

export function renderRuntimeSection(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider | null,
  thinkingLevel: string,
  rows: number,
  palette: Palette,
  width = RAIL_CONTENT,
): string[] {
  if (rows <= 0) return [];
  const lines: string[] = [];
  const push = (line: string) => { if (lines.length < rows) lines.push(line); };
  const bg = palette.bgBase;

  const model = ctx.model;
  if (model) {
    const provider = footerData && footerData.getAvailableProviderCount() > 1 ? `${model.provider}/` : "";
    push(railRow(palette, `${palette.textMid}${clip(`${provider}${model.id}`, width)}${RST}`, bg, width));
  }
  const usage = computeUsage(ctx);
  const percent = usage.contextPercent === null ? "?" : `${Math.round(usage.contextPercent)}%`;
  const thinking = model?.reasoning ? `${palette.meta}${thinkingLevel} ·${RST} ` : "";
  push(railRow(palette, `${thinking}${palette.meta}ctx${RST} ${palette.textMid}${percent}${RST} ${palette.meta}·${RST} ${palette.textMid}${formatCost(usage.cost)}${RST}`, bg, width));
  while (lines.length < rows) push(railRow(palette, "", bg, width));
  return lines;
}
