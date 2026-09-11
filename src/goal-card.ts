import { visibleWidth } from "@earendil-works/pi-tui";
import { breathe, isVictory, type EasedMeter } from "./anim.ts";
import type { ThreadGoal } from "./goal.ts";
import type { Palette, RGB } from "./palette.ts";
import { fgRgb, rgbLerp } from "./palette.ts";
import { ghostHeader, meterTrack, pressureColor, railRow } from "./sections.ts";
import { RST, clip, formatElapsed, formatTokens, meterCells } from "./style.ts";

const METER_CELLS = 12;

function goalStatus(palette: Palette, goal: ThreadGoal): { color: string; label: string } {
  switch (goal.status) {
    case "active": return { color: palette.badgeAdded, label: "ACTIVE" };
    case "complete": return { color: palette.badgeAdded, label: "COMPLETE" };
    case "paused": return { color: palette.badgeModified, label: "PAUSED" };
    case "budgetLimited": return { color: palette.badgeDeleted, label: "BUDGET" };
  }
}

/** The ambient status dot: a slow breath, brighter than the trough so it never vanishes. */
function statusDot(palette: Palette, now: number): string {
  const level = 0.35 + 0.65 * breathe(now);
  if (palette.truecolor && palette.dotDim && palette.dotPeak) {
    return `${fgRgb(rgbLerp(palette.dotDim, palette.dotPeak, level) as RGB)}●${RST}`;
  }
  const step = Math.round(level * (palette.dotFallback.length - 1));
  return `${palette.dotFallback[step] ?? palette.ghost}●${RST}`;
}

/** Wraps the objective into at most three lines, clipping the last. */
function titleLines(objective: string, width: number, maxLines: number): string[] {
  const words = objective.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  let index = 0;
  for (; index < words.length; index++) {
    const candidate = current ? `${current} ${words[index]}` : words[index]!;
    if (visibleWidth(candidate) > width && current) {
      lines.push(current);
      current = words[index]!;
      if (lines.length === maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
    index++;
  }
  if (lines.length === maxLines && index < words.length) {
    lines[maxLines - 1] = clip(`${lines[maxLines - 1]} ${words.slice(index).join(" ")}`, width);
  }
  return lines;
}

/**
 * The goal card: the rail's hero. It sits on the raised panel step, opens
 * with a breathing status dot and the budget share, carries the objective in
 * bold across up to three lines, and closes with a smooth budget meter whose
 * fill eases toward the live ratio. A missing goal is a single ghost row.
 */
export function renderGoalSection(
  goal: ThreadGoal | null,
  rows: number,
  palette: Palette,
  now: number,
  budgetMeter: EasedMeter,
  width = 39,
  shimmer: number | null = null,
  victoryAt: number | null = null,
): string[] {
  if (rows <= 0) return [];
  const lines: string[] = [];
  const push = (line: string) => { if (lines.length < rows) lines.push(line); };

  if (!goal) {
    push(ghostHeader(palette, "no goal · /goal <objective>", palette.bgDeep, "", width));
    while (lines.length < rows) push(railRow(palette, "", palette.bgDeep, width));
    return lines;
  }

  const bg = palette.bgPanel;
  const status = goalStatus(palette, goal);
  const hasBudget = Boolean(goal.tokenBudget);
  const ratio = hasBudget ? goal.usage.tokensUsed / goal.tokenBudget! : null;
  const share = ratio === null ? "" : `${Math.round(Math.min(ratio, 9.99) * 100)}%`;

  push(railRow(palette, `${statusDot(palette, now)} ${status.color}${palette.bold(status.label)}${RST}${share ? `${palette.ghostBright}${" ".repeat(Math.max(1, width - status.label.length - 2 - share.length))}${share}${RST}` : ""}`, bg, width));
  if (rows >= 6) push(railRow(palette, "", bg, width));

  const maxLines = rows >= 7 ? 3 : 2;
  // The completion flash: for a beat after the goal flips to complete, the
  // title wears the success color before settling back to content white.
  const titleColor = victoryAt !== null && isVictory(now, victoryAt) ? palette.badgeAdded : palette.textNew;
  for (const line of titleLines(goal.objective, width, maxLines)) {
    push(railRow(palette, `${palette.bold(`${titleColor}${clip(line, width)}${RST}`)}`, bg, width));
  }
  if (rows >= 8) push(railRow(palette, "", bg, width));

  const meterColor = goal.status === "complete" ? palette.badgeAdded
    : goal.status === "budgetLimited" || (hasBudget && goal.usage.tokensUsed > goal.tokenBudget!) ? palette.badgeDeleted
    : pressureColor(palette, ratio);
  const meter = meterCells(budgetMeter.get() ?? ratio, METER_CELLS, meterColor, meterTrack(palette), "─", shimmer);
  const label = `${palette.ghost}bdg${RST} `;
  const used = formatTokens(goal.usage.tokensUsed);
  const counts = hasBudget ? `${used}/${formatTokens(goal.tokenBudget!)}` : `${used} tokens`;
  const elapsed = formatElapsed(goal.usage.activeSeconds);
  const full = `${label}${meter ? `${meter} ` : ""}${palette.textMid}${counts}${RST} ${palette.ghost}·${RST} ${palette.textMid}${elapsed}${RST}`;
  const fits = 4 + (meter ? METER_CELLS + 1 : 0) + visibleWidth(counts) + 3 + visibleWidth(elapsed) <= width;
  push(railRow(palette, fits ? full : `${label}${meter ? `${meter} ` : ""}${palette.textMid}${counts}${RST}`, bg, width));

  while (lines.length < rows) push(railRow(palette, "", bg, width));
  return lines;
}
