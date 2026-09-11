import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { goalStatus } from "./goal-card.ts";
import type { ThreadGoal } from "./goal.ts";
import { FORNACE_FLAG, FORNACE_FLAG_256, fgRgb, type Palette } from "./palette.ts";
import { meterTrack, pressureColor } from "./sections.ts";
import type { Usage } from "./status-dock.ts";
import { RST, clip, formatCost, formatCwd, fillRow, meterCells } from "./style.ts";
import type { UserMessage } from "./types.ts";

/**
 * The footer mode: the rail's minimal double, docked as a two-row footer
 * when the terminal is too narrow for the full rail or the mode shortcut
 * pinned it there. Row one carries the crown, goal status, context meter and
 * spend; row two carries the tail of the message stream plus the way back.
 */
export const FOOTER_MODE_HINT = "[Ctrl+Shift+S] sidebar";
export const FOOTER_ROWS = 2;

const METER_CELLS = 8;

export type FooterRailInput = {
  ctx: ExtensionContext;
  footerData: ReadonlyFooterDataProvider | null;
  palette: Palette;
  goal: ThreadGoal | null;
  usage: Usage;
  messages: UserMessage[];
  summaryFor: (message: UserMessage) => string;
};

type Segment = { text: string; priority: number };

/** A three-cell chip of the Fornace flag, the crown's smallest form. */
function flagChip(palette: Palette): string {
  const parts: string[] = [];
  for (let index = 0; index < 3; index++) {
    const hue = index % FORNACE_FLAG.length;
    parts.push(palette.truecolor
      ? `${fgRgb(FORNACE_FLAG[hue]!)}█${RST}`
      : `\x1b[38;5;${FORNACE_FLAG_256[hue]}m█${RST}`);
  }
  return parts.join("");
}

function goalSegment(palette: Palette, goal: ThreadGoal | null): Segment {
  if (!goal) return { text: `${palette.ghost}◇ no goal${RST}`, priority: 1 };
  const status = goalStatus(palette, goal);
  const ratio = goal.tokenBudget ? Math.min(1, goal.usage.tokensUsed / goal.tokenBudget) : null;
  const share = ratio === null ? "" : ` ${Math.round(ratio * 100)}%`;
  const text = `${status.color}●${RST} ${palette.bold(`${status.color}${status.label}${RST}`)}${palette.ghostBright}${share}${RST}`;
  return { text, priority: 1 };
}

function ctxSegment(palette: Palette, usage: Usage): Segment {
  const percent = usage.contextPercent === null || !Number.isFinite(usage.contextPercent)
    ? null
    : Math.round(usage.contextPercent);
  const ratio = percent === null ? null : percent / 100;
  const meter = meterCells(ratio, METER_CELLS, pressureColor(palette, ratio), meterTrack(palette), "─");
  const pct = percent === null ? "?" : `${percent}%`;
  const label = `${palette.ghost}ctx${RST} `;
  return { text: meter ? `${label}${meter} ${palette.textMid}${pct}${RST}` : `${label}${palette.textMid}${pct}${RST}`, priority: 2 };
}

/** Drops the least important segments until the joined row fits; goal survives longest. */
function packRow(width: number, segments: Segment[], separator: string): string {
  const kept = [...segments];
  const total = () => kept.reduce((sum, segment, index) => sum + visibleWidth(segment.text) + (index ? 3 : 0), 0);
  while (kept.length > 0 && total() > width) {
    let drop = 0;
    for (let index = 1; index < kept.length; index++) {
      if (kept[index]!.priority >= kept[drop]!.priority) drop = index;
    }
    kept.splice(drop, 1);
  }
  return kept.map((segment) => segment.text).join(separator);
}

function statusRow(input: FooterRailInput, palette: Palette, width: number): string {
  const bg = palette.bgDeep;
  const prefix = `${palette.edge}│${RST}${bg} ${flagChip(palette)} `;
  const budget = width - visibleWidth(prefix) - 1;
  if (budget <= 0) return fillRow(prefix, width, bg);
  const separator = ` ${palette.ghost}·${RST} `;
  const model = input.ctx.model;
  const segments: Segment[] = [
    goalSegment(palette, input.goal),
    ctxSegment(palette, input.usage),
  ];
  const count = input.messages.length;
  if (count > 0) {
    const noun = count === 1 ? "msg" : "msgs";
    segments.push({ text: `${palette.textMid}${count} ${noun}${RST}`, priority: 3 });
  }
  if (input.usage.cost > 0) segments.push({ text: `${palette.textMid}${formatCost(input.usage.cost)}${RST}`, priority: 4 });
  if (model) {
    const provider = input.footerData && input.footerData.getAvailableProviderCount() > 1 ? `${model.provider}/` : "";
    segments.push({ text: `${palette.textOld}${provider}${model.id}${RST}`, priority: 5 });
  }
  return fillRow(`${prefix}${packRow(budget, segments, separator)}`, width, bg);
}

function streamRow(input: FooterRailInput, palette: Palette, width: number): string {
  const bg = palette.bgPanel;
  const prefix = `${palette.edge}│${RST}${bg} `;
  const inner = width - visibleWidth(prefix);
  if (inner <= 0) return fillRow(prefix, width, bg);
  const hintPlain = clip(FOOTER_MODE_HINT, inner);
  const hint = `${palette.ghost}${hintPlain}${RST}`;
  const hintWidth = hintPlain.length;
  const marker = `${palette.ghostBright}»${RST} `;
  const last = input.messages.at(-1);
  const markerWidth = 2;
  if (inner < hintWidth + markerWidth + 4) return fillRow(`${prefix}${hint}`, width, bg);

  const budget = inner - hintWidth - markerWidth - 2;
  const bodyPlain = last ? input.summaryFor(last) : formatCwd(input.ctx.sessionManager.getCwd());
  const body = last
    ? `${palette.textMid}${clip(bodyPlain, budget)}${RST}`
    : `${palette.ghost}${clip(bodyPlain, budget)}${RST}`;
  const bodyWidth = Math.min(visibleWidth(bodyPlain), budget);
  const pad = " ".repeat(Math.max(0, inner - markerWidth - bodyWidth - hintWidth));
  return fillRow(`${prefix}${marker}${body}${pad}${hint}`, width, bg);
}

/** Exactly two rows: the status band and the stream tail, both exactly `width` cells. */
export function renderFooterRail(input: FooterRailInput, width: number): string[] {
  const palette = input.palette;
  return [statusRow(input, palette, width), streamRow(input, palette, width)];
}
