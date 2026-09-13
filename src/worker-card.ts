import { visibleWidth } from "@earendil-works/pi-tui";
import type { Palette } from "./palette.ts";
import { ghostHeader, railRow, RAIL_CONTENT } from "./sections.ts";
import { clip, formatElapsed, formatTokens, RST } from "./style.ts";
import { isWorking, needsAttention, plainSnippet, visibleWorkers, type WorkerCard } from "./worker-activity.ts";

/** Each glyph is one observed request's token volume, with a fixed 200K ceiling. */
function tokenTrace(card: WorkerCard): string {
  const glyphs = "▁▂▃▄▅▆▇█";
  const deltas = card.samples.slice(1).map((sample, i) => Math.max(0, sample.tokens - card.samples[i]!.tokens));
  return deltas.slice(-6).map(delta => glyphs[Math.min(7, Math.floor(delta / 200_000 * 7))]).join("");
}

export function workerRowsWanted(cards: WorkerCard[]): number {
  if (!cards.length) return 0;
  const live = visibleWorkers(cards).length;
  return live ? 2 + Math.min(4, live) * 3 : 2;
}

/** Three rows per visible worker: state, observed action, quoted statement. */
export function renderWorkerSection(cards: WorkerCard[], rows: number, palette: Palette, now: number): string[] {
  if (rows <= 0) return [];
  const lines: string[] = [];
  const bg = palette.bgDeep;
  const live = visibleWorkers(cards);
  const active = cards.filter(isWorking).length;
  const attention = cards.filter(needsAttention).length;
  const idle = cards.filter(card => card.state === "idle").length;
  const closed = cards.filter(card => card.state === "completed" || card.state === "aborted").length;
  const queued = cards.filter(card => card.state === "queued").length;
  const headline = `${attention ? `${attention} attention · ` : ""}${active} active${queued ? ` · ${queued} queued` : ""}`;
  lines.push(ghostHeader(palette, "CREW", bg, headline));
  const cardSlots = Math.max(0, Math.floor((rows - 2) / 3));
  for (const card of live.slice(0, cardSlots)) {
    const urgent = needsAttention(card);
    const tint = urgent ? palette.badgeModified : palette.accent;
    const mark = card.state === "queued" ? "○" : card.state === "paused" ? "Ⅱ" : card.state === "failed" ? "!" : "●";
    const age = formatElapsed(Math.max(0, now - card.at) / 1000);
    const right = `${formatTokens(card.tokens)} tok`;
    const left = `${mark} ${card.handle}`;
    const name = clip(left, RAIL_CONTENT - visibleWidth(right) - 1);
    const gap = " ".repeat(Math.max(1, RAIL_CONTENT - visibleWidth(name) - visibleWidth(right)));
    lines.push(railRow(palette, `${tint}${name}${RST}${gap}${palette.ghostBright}${right}${RST}`, bg));
    const action = urgent || card.state === "queued" ? card.state : card.observed || card.state;
    const trace = tokenTrace(card);
    const meta = `${trace}${trace ? " " : ""}${age}`;
    const actionText = clip(`↳ ${action}`, RAIL_CONTENT - visibleWidth(meta) - 1);
    const actionGap = " ".repeat(Math.max(1, RAIL_CONTENT - visibleWidth(actionText) - visibleWidth(meta)));
    lines.push(railRow(palette, `${palette.textMid}${actionText}${RST}${actionGap}${palette.ghost}${meta}${RST}`, bg));
    const statement = urgent && card.event?.reason ? plainSnippet(card.event.reason)
      : card.quote ? `“${card.quote}”` : card.task ? `→ ${card.task}` : "";
    lines.push(railRow(palette, `${palette.textOld}${clip(statement, RAIL_CONTENT)}${RST}`, bg));
  }
  const hidden = live.length - Math.min(live.length, cardSlots);
  const remainder = [hidden ? `+${hidden} more` : "", idle ? `${idle} idle` : "", closed ? `${closed} closed` : ""].filter(Boolean).join(" · ");
  if (lines.length < rows) lines.push(railRow(palette, `${palette.ghostBright}${remainder}${RST}`, bg));
  while (lines.length < rows) lines.push(railRow(palette, "", bg));
  return lines;
}
