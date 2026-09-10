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

/**
 * Section header: a rule with the label embedded and metadata right-aligned.
 * This replaces the old label-row-plus-separator pair and returns one row
 * where the old design spent two.
 */
export function headerRow(palette: Palette, label: string, bg: string, right = "", width = RAIL_CONTENT): string {
  const rightCells = right ? visibleWidth(right) + 1 : 0;
  const dashes = Math.max(0, width - visibleWidth(`── ${label} `) - rightCells);
  const content = [
    palette.rule, "── ",
    palette.label, label, " ",
    palette.rule, "─".repeat(dashes),
    ...(right ? [" ", right] : []),
  ].join("");
  return railRow(palette, content, bg, width);
}

/** Meter cells: heavy stroke for the used share, light for the free share. */
const METER_CELLS = 10;

/**
 * A usage meter in the same language as the section rules: `━━━──────`.
 * Color tracks pressure: accent normally, warning at 60 percent, danger at
 * 85; callers may override for terminal goal states.
 */
export function meterBar(palette: Palette, ratio: number | null, color?: string): string {
  if (ratio === null || !Number.isFinite(ratio)) return "";
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * METER_CELLS);
  const barColor = color
    ?? (clamped >= 0.85 ? palette.badgeDeleted : clamped >= 0.6 ? palette.badgeModified : palette.accent);
  return `${barColor}${"━".repeat(filled)}${RST}${palette.rule}${"─".repeat(Math.max(0, METER_CELLS - filled))}${RST}`;
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

/** Wraps the objective into at most two lines, clipping the second. */
function titleLines(objective: string, width: number): [string, string] {
  const words = objective.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  let index = 0;
  for (; index < words.length; index++) {
    const candidate = current ? `${current} ${words[index]}` : words[index]!;
    if (visibleWidth(candidate) > width && current) {
      lines.push(current);
      current = words[index]!;
      if (lines.length === 2) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < 2 && current) {
    lines.push(current);
    index++;
  }
  if (lines.length === 2 && index < words.length) {
    lines[1] = clip(`${lines[1]} ${words.slice(index).join(" ")}`, width);
  }
  return [lines[0] ?? "—", lines[1] ?? ""];
}

/** The budget row: meter, counts, and elapsed, compacting when crowded. */
function budgetRow(goal: ThreadGoal, palette: Palette, width: number): string {
  const elapsed = formatElapsed(goal.usage.activeSeconds);
  const used = formatTokens(goal.usage.tokensUsed);
  const hasBudget = Boolean(goal.tokenBudget);
  const overBudget = hasBudget && goal.usage.tokensUsed > goal.tokenBudget!;
  const meterColor = goal.status === "complete" ? palette.badgeAdded
    : goal.status === "budgetLimited" || overBudget ? palette.badgeDeleted
    : undefined;
  const meter = meterBar(palette, hasBudget ? goal.usage.tokensUsed / goal.tokenBudget! : null, meterColor);
  const countsColor = overBudget ? palette.badgeDeleted : palette.textMid;
  const full = hasBudget
    ? `${used} / ${formatTokens(goal.tokenBudget!)} tokens`
    : `${used} tokens · unlimited`;
  const compact = hasBudget ? `${used}/${formatTokens(goal.tokenBudget!)}` : `${used} tokens`;
  const fits = METER_CELLS + 1 + visibleWidth(full) + 3 + visibleWidth(elapsed) <= width;
  const counts = fits ? full : compact;
  if (!meter) {
    return `${countsColor}${counts}${RST} ${palette.meta}·${RST} ${palette.textMid}${elapsed}${RST}`;
  }
  return `${meter} ${countsColor}${counts}${RST} ${palette.meta}·${RST} ${palette.textMid}${elapsed}${RST}`;
}

/**
 * The goal is the primary element: header rule with the live status, bold
 * title, and a budget meter, on the raised step of the background ladder.
 * A missing goal is a single quiet rule row carrying the guidance.
 */
export function renderGoalSection(goal: ThreadGoal | null, rows: number, palette: Palette, width = RAIL_CONTENT): string[] {
  if (rows <= 0) return [];
  const lines: string[] = [];
  const push = (line: string) => { if (lines.length < rows) lines.push(line); };
  // The raised step is emphasis: a missing goal is a placeholder, not content.
  const bg = goal ? palette.bgRaised : palette.bgBase;

  if (!goal) {
    const text = "no goal · /goal <objective>";
    const dashes = Math.max(0, width - visibleWidth(`── ${text} `));
    push(railRow(palette, `${palette.rule}──${RST} ${palette.meta}${text}${RST} ${palette.rule}${"─".repeat(dashes)}${RST}`, bg, width));
    while (lines.length < rows) push(railRow(palette, "", bg, width));
    return lines;
  }

  const status = goalStatus(palette, goal);
  push(headerRow(palette, "GOAL", bg, `${status.color}${palette.bold(`${status.icon} ${status.label}`)}${RST}`, width));
  if (rows >= 5) push(railRow(palette, "", bg, width));
  const [first, second] = titleLines(goal.objective, width);
  push(railRow(palette, `${palette.bold(`${palette.textNew}${clip(first, width)}${RST}`)}`, bg, width));
  push(railRow(palette, `${palette.bold(`${palette.textNew}${clip(second, width)}${RST}`)}`, bg, width));
  if (rows >= 7) push(railRow(palette, "", bg, width));
  push(railRow(palette, budgetRow(goal, palette, width), bg, width));
  if (rows >= 6) push(railRow(palette, "", bg, width));
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
 * Session identity plus the write footprint in one block: header rule with
 * the branch, surface and workspace, cwd, session id, then a FILES
 * subsection whose header counts distinct files and whose rows carry the
 * git letter convention (M/A/U/D/R) in front of front-trimmed paths.
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

  const branch = footerData?.getGitBranch() ?? null;
  const branchRight = branch
    ? `${palette.textMid}${clip(branch, width - visibleWidth("── SESSION ") - 1)}${RST}`
    : "";
  push(headerRow(palette, "SESSION", bg, branchRight, width));

  const surface = cmux?.surfaceRef ?? "surface n/a";
  const workspace = cmux?.workspaceTitle ?? cmux?.workspaceRef ?? "";
  const identityRow = workspace
    ? `${palette.surface}${surface}${RST} ${palette.meta}·${RST} ${palette.textMid}${clip(workspace, Math.max(1, width - visibleWidth(surface) - 3))}${RST}`
    : `${palette.surface}${surface}${RST}`;
  push(railRow(palette, identityRow, bg, width));
  push(railRow(palette, `${palette.textMid}${ellipsizePath(formatCwd(ctx.sessionManager.getCwd()), width)}${RST}`, bg, width));
  if (rows >= 4) {
    const sessionId = ctx.sessionManager.getSessionId().replace(/-/g, "").slice(0, 8);
    push(railRow(palette, `${palette.meta}session${RST} ${palette.textMid}${sessionId}${RST}`, bg, width));
  }
  // The FILES subsection needs its header plus at least one file row.
  if (files.length > 0 && rows - lines.length >= 2) {
    const noun = files.length === 1 ? "file" : "files";
    push(headerRow(palette, "FILES", bg, `${palette.meta}${files.length} ${noun}${RST}`, width));
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
  const thinkingRight = model?.reasoning
    ? `${palette.meta}${clip(thinkingLevel, width - visibleWidth("── RUNTIME ") - 1)}${RST}`
    : "";
  push(headerRow(palette, "RUNTIME", bg, thinkingRight, width));
  if (model) {
    const provider = footerData && footerData.getAvailableProviderCount() > 1 ? `${model.provider}/` : "";
    push(railRow(palette, `${palette.textMid}${clip(`${provider}${model.id}`, width)}${RST}`, bg, width));
  }
  const usage = computeUsage(ctx);
  const percent = usage.contextPercent === null ? null : Math.round(usage.contextPercent);
  const meter = meterBar(palette, percent === null ? null : percent / 100);
  const percentText = percent === null ? "?" : `${percent}%`;
  const meterText = meter
    ? `${palette.meta}ctx${RST} ${meter} ${palette.textMid}${percentText}${RST}`
    : `${palette.meta}ctx${RST} ${palette.textMid}${percentText}${RST}`;
  push(railRow(palette, `${meterText} ${palette.meta}·${RST} ${palette.textMid}${formatCost(usage.cost)}${RST}`, bg, width));
  while (lines.length < rows) push(railRow(palette, "", bg, width));
  return lines;
}
