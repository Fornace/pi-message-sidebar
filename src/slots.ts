import { DOT_GLYPH, arriveProgress, glowStrength, pulse, settlePhase } from "./anim.ts";
import type { Palette } from "./palette.ts";
import { bgRgb, fgRgb, rgbLerp } from "./palette.ts";
import { RAIL_CONTENT, railRow } from "./sections.ts";
import { RST, clip, formatTime, wrapText } from "./style.ts";
import type { UserMessage } from "./types.ts";

/** Cells in front of the summary text: marker, time, space. The ordinal is
 *  gone: its four cells buy summary text instead. */
export const META_CELLS = 7;
export const TEXT_CELLS = RAIL_CONTENT - META_CELLS;
/** Messages this far from the newest read as current; older ones fade. */
const FRESH_WINDOW = 4;

export type SlotDeps = {
  getSummary: (messageId: string, text: string) => string;
  hasSummary: (messageId: string) => boolean;
  isPending: (messageId: string) => boolean;
};

/** Per-message animation memory the panel owns and slots read. */
export type SlotMemory = {
  seenSummary: Map<string, boolean>;
  landedAt: Map<string, number>;
  arrivedAt: Map<string, number>;
};

/**
 * One message slot: two rail rows carrying the marker, the time, and the
 * summary wrapped across both text cells. The selection bar spans both rows
 * as a yellow edge; pending summaries pulse; landed summaries sweep accent
 * and glow-decay; arrivals reveal left to right; age fades the rest.
 */
export function slotRows(
  message: UserMessage,
  index: number,
  total: number,
  selected: boolean,
  palette: Palette,
  now: number,
  deps: SlotDeps,
  memory: SlotMemory,
): string[] {
  const pending = deps.isPending(message.id);
  const bar = selected ? `${palette.badgeModified}▎${RST}` : " ";
  const marker = pending ? pendingDot(palette, now) : bar;
  const secondMarker = pending ? " " : bar;
  const time = formatTime(message.timestamp).padEnd(5);
  const meta = `${palette.ghost}${time}${RST} `;
  const arrived = memory.arrivedAt.get(message.id);
  const progress = arrived === undefined ? 1 : arriveProgress(now, arrived);
  const text = summaryLines(message, progress, deps);
  const color = textColor(message, index, total, selected, palette, now, deps, memory);
  const background = slotBackground(message, selected, palette, now, memory);
  const first = `${marker}${meta}${color}${text[0]}${RST}`;
  const second = `${secondMarker}${" ".repeat(META_CELLS - 1)}${color}${text[1]}${RST}`;
  return [
    railRow(palette, first, background),
    railRow(palette, second, background),
  ];
}

/**
 * The slot surface: a selection is the soft accent tint, and a message whose
 * summary just landed keeps a decaying glow over the deep canvas. Everything
 * else floats on deep.
 */
function slotBackground(message: UserMessage, selected: boolean, palette: Palette, now: number, memory: SlotMemory): string {
  if (selected) return palette.bgSelect;
  const landed = memory.landedAt.get(message.id);
  if (landed === undefined || !palette.truecolor || !palette.glowFrom || !palette.glowTo) return palette.bgDeep;
  const strength = glowStrength(now, landed);
  return strength > 0 ? bgRgb(rgbLerp(palette.glowTo, palette.glowFrom, strength)) : palette.bgDeep;
}

/** The working dot: a fast pulse while the summary is still in flight. */
function pendingDot(palette: Palette, now: number): string {
  if (palette.truecolor && palette.dotDim && palette.dotPeak) {
    return `${fgRgb(rgbLerp(palette.dotDim, palette.dotPeak, pulse(now, 0)))}${DOT_GLYPH}${RST}`;
  }
  const step = Math.round(pulse(now, 0) * (palette.dotFallback.length - 1));
  return `${palette.dotFallback[step] ?? palette.ghost}${DOT_GLYPH}${RST}`;
}

/** Age fade like pi-recap: newest bright, recent normal, older muted; a
 *  landing summary sweeps accent then bold accent before settling. */
function textColor(
  message: UserMessage,
  index: number,
  total: number,
  selected: boolean,
  palette: Palette,
  now: number,
  deps: SlotDeps,
  memory: SlotMemory,
): string {
  const has = deps.hasSummary(message.id);
  const was = memory.seenSummary.get(message.id);
  if (has && was === false) memory.landedAt.set(message.id, now);
  memory.seenSummary.set(message.id, has);

  const landed = memory.landedAt.get(message.id);
  if (has && landed !== undefined) {
    const phase = settlePhase(now, landed);
    if (phase === 1) return palette.accent;
    if (phase === 2) return palette.bold(palette.accent);
  }
  if (selected) return palette.textNew;
  if (!has) return palette.preview;
  const distance = total - 1 - index;
  if (distance === 0) return palette.textNew;
  if (distance <= FRESH_WINDOW) return palette.textMid;
  return palette.textOld;
}

/** The summary wrapped into the two text cells of a message slot. While a
 *  slot is arriving, the first line reveals left to right and the second
 *  waits its turn. */
function summaryLines(message: UserMessage, progress: number, deps: SlotDeps): [string, string] {
  const wrapped = wrapText(deps.getSummary(message.id, message.text), TEXT_CELLS);
  if (progress < 1) {
    const reveal = Math.max(1, Math.floor(progress * TEXT_CELLS));
    return [clip(wrapped[0] ?? "", reveal), ""];
  }
  if (wrapped.length <= 1) return [wrapped[0] ?? "", ""];
  const second = wrapped.length > 2
    ? clip(wrapped.slice(1).join(" "), TEXT_CELLS)
    : wrapped[1]!;
  return [wrapped[0]!, second];
}
