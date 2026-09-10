import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { DOT_GLYPH, isSettling, pulse, settlePhase } from "./anim.ts";
import type { Palette } from "./palette.ts";
import { fgRgb, rgbLerp } from "./palette.ts";
import { RAIL_CONTENT, railRow } from "./sections.ts";
import { RST, clip, formatCount, formatTime, wrapText } from "./style.ts";
import type { UserMessage } from "./types.ts";

export type { UserMessage };

type MessagePanelOptions = {
  /** Display summary for a message: model summary when present, preview otherwise. */
  getSummary: (messageId: string, text: string) => string;
  /** Whether the model has written this message's summary yet. */
  hasSummary: (messageId: string) => boolean;
  /** Whether a summary request for this message is still in flight. */
  isPending: (messageId: string) => boolean;
  /** Whether the summary gateway is configured at all (shows the setup hint). */
  summariesConfigured: () => boolean;
  requestRefresh: () => void;
};

/** Cells in front of the summary text: marker, ordinal, space, time, space. */
const META_CELLS = 11;
const TEXT_CELLS = RAIL_CONTENT - META_CELLS;
/** One message always occupies a two-row slot: summary line plus its wrap. */
const ROWS_PER_MESSAGE = 2;
const SETUP_HINT = "AI summaries need FORNACE_LLM_API_KEY";
/** Messages this far from the newest read as current; older ones fade. */
const FRESH_WINDOW = 4;

export function detailCapacity(rows: number, wrappedCount: number): { textCapacity: number; hasIndicator: boolean; maxScroll: number } {
  const available = Math.max(0, rows - 1);
  if (wrappedCount <= available) {
    return { textCapacity: available, hasIndicator: false, maxScroll: 0 };
  }
  // A two-row grant leaves no room for text plus indicator: the indicator
  // becomes the only body row and reports the scroll position instead.
  if (available <= 1) {
    return { textCapacity: 0, hasIndicator: true, maxScroll: Math.max(0, wrappedCount - 1) };
  }
  const textCapacity = available - 1;
  const maxScroll = Math.max(0, wrappedCount - textCapacity);
  return { textCapacity, hasIndicator: true, maxScroll };
}

/**
 * Owns the message list: selection, follow-tail, the two-row message grid,
 * the hidden-count ellipsis rows, and the expanded detail view. Rendering is
 * pure row arithmetic: every entry point returns exactly the rows it was
 * granted, because a short section surfaces as a fatal height mismatch in
 * pi's render loop.
 */
export class MessagePanel {
  private messages: UserMessage[];
  private selectedId: string | null;
  private detailId: string | null = null;
  private detailScroll = 0;
  private lastDetailRows = 1;
  private followTail = true;
  private viewportStartId: string | null = null;
  private wrapCache: { id: string; lines: string[] } | null = null;
  private readonly seenSummary = new Map<string, boolean>();
  private readonly landedAt = new Map<string, number>();

  constructor(
    private readonly options: MessagePanelOptions,
    messages: UserMessage[],
  ) {
    this.messages = messages;
    this.selectedId = messages.at(-1)?.id ?? null;
  }

  getSelectedMessageId(): string | null { return this.selectedId; }
  isFollowingTail(): boolean { return this.followTail; }
  isExpanded(messageId: string): boolean { return this.detailId === messageId; }
  isDetailOpen(): boolean { return this.detailId !== null; }

  updateMessages(messages: UserMessage[]): void {
    const previousId = this.selectedId;
    const previousStartId = this.viewportStartId;
    this.messages = messages;
    const ids = new Set(messages.map((message) => message.id));
    if (this.detailId && !ids.has(this.detailId)) { this.detailId = null; this.detailScroll = 0; }
    this.viewportStartId = previousStartId && ids.has(previousStartId) ? previousStartId : null;

    if (this.followTail || !previousId || !ids.has(previousId)) {
      this.selectedId = messages.at(-1)?.id ?? null;
      this.followTail = true;
      this.viewportStartId = null;
    } else {
      this.selectedId = previousId;
    }
    this.options.requestRefresh();
  }

  handleInput(data: string): void {
    if (this.detailId) return this.handleDetailInput(data);
    const current = this.selectedIndex();
    let target: number | null = null;
    if (matchesKey(data, "up")) target = Math.max(0, current - 1);
    else if (matchesKey(data, "down")) target = Math.min(this.messages.length - 1, current + 1);
    else if (matchesKey(data, "pageUp")) target = Math.max(0, current - 10);
    else if (matchesKey(data, "pageDown")) target = Math.min(this.messages.length - 1, current + 10);
    else if (matchesKey(data, "home")) target = 0;
    else if (matchesKey(data, "end")) target = Math.max(0, this.messages.length - 1);
    else if (matchesKey(data, "return") || matchesKey(data, "enter") || data === " ") {
      if (this.selectedId) { this.detailId = this.selectedId; this.detailScroll = 0; this.options.requestRefresh(); }
      return;
    } else return;

    if (target < 0 || !this.messages[target]) return;
    this.selectedId = this.messages[target].id;
    this.followTail = target === this.messages.length - 1;
    if (this.followTail) this.viewportStartId = null;
    this.options.requestRefresh();
  }

  closeDetail(): void {
    if (!this.detailId) return;
    this.detailId = null;
    this.detailScroll = 0;
    this.options.requestRefresh();
  }

  /** True while a pulsing dot or a settle sweep needs the animation tick. */
  needsAnim(now: number): boolean {
    for (const message of this.messages) {
      if (this.options.isPending(message.id)) return true;
    }
    for (const [id, at] of this.landedAt) {
      if (isSettling(now, at)) return true;
      if (now - at > 5000) this.landedAt.delete(id);
    }
    return false;
  }

  /** Renders exactly `rows` lines: heading, optional setup hint, viewport, hint strip. */
  renderSection(rows: number, focused: boolean, palette: Palette, now: number): string[] {
    const total = this.messages.length;
    const detailIndex = this.detailId ? this.indexForId(this.detailId) : -1;
    const position = detailIndex >= 0 ? detailIndex + 1 : this.selectedIndex() + 1;
    const heading = this.headingRow(
      palette,
      this.detailId ? "MESSAGE" : "MESSAGES",
      total > 0 || this.detailId ? `${position}/${total}` : `0/${total}`,
    );

    if (this.detailId) {
      const detailRows = Math.max(1, rows - 2);
      const detail = this.renderDetail(this.detailId, detailRows, palette).slice(0, detailRows);
      // Only offer scrolling when there is something below the fold.
      const message = this.messages[this.indexForId(this.detailId)];
      const scrollable = message !== undefined
        && detailCapacity(detailRows, this.wrappedDetail(message).length).hasIndicator;
      return [heading, ...detail, this.hintRow(palette, scrollable ? "Esc back · ↑↓ scroll" : "Esc back")].slice(0, rows);
    }

    // The setup hint replaces the spacer row under the heading; a message
    // slot is never sacrificed for it.
    const showSetupHint = !this.options.summariesConfigured() && rows >= 5;
    const spacer = rows >= (showSetupHint ? 6 : 5);
    const consumed = 1 + (showSetupHint ? 1 : 0) + (spacer ? 1 : 0) + 1;
    const viewportRows = Math.max(2, rows - consumed);
    const sections = [
      heading,
      ...(showSetupHint ? [railRow(palette, `${palette.meta}${SETUP_HINT}${RST}`, palette.bgBase)] : []),
      ...(spacer ? [railRow(palette, "", palette.bgBase)] : []),
      ...this.renderViewport(viewportRows, focused, palette, now),
      this.hintRow(palette, focused ? "↑↓ select · Enter open · c copy" : "Ctrl+Shift+H focus"),
    ];
    while (sections.length < rows) sections.push(railRow(palette, "", palette.bgBase));
    return sections.slice(0, rows);
  }

  // --- list rendering ------------------------------------------------------

  private headingRow(palette: Palette, label: string, right: string): string {
    const gap = Math.max(1, RAIL_CONTENT - visibleWidth(label) - visibleWidth(right));
    return railRow(palette, `${palette.label}${label}${RST}${" ".repeat(gap)}${palette.meta}${right}${RST}`, palette.bgBase);
  }

  private hintRow(palette: Palette, text: string): string {
    return railRow(palette, `${palette.meta}${text}${RST}`, palette.bgSunken);
  }

  /** Always returns exactly `rows` lines: ellipsis rows, message pairs, padding. */
  private renderViewport(rows: number, focused: boolean, palette: Palette, now: number): string[] {
    if (this.messages.length === 0) {
      const empty = [railRow(palette, `${palette.preview}No messages yet${RST}`, palette.bgBase)];
      while (empty.length < rows) empty.push(railRow(palette, "", palette.bgBase));
      return empty;
    }

    const window = this.resolveWindow(rows);
    const pairs: string[] = [];
    for (let index = window.start; index < window.end; index++) {
      pairs.push(...this.messageRows(index, focused, palette, now));
    }
    // A message pair outranks an ellipsis row when both cannot fit.
    const topCount = window.start > 0 && 1 + pairs.length <= rows;
    const bottomCount = window.end < this.messages.length && (topCount ? 2 : 1) + pairs.length <= rows;
    const lines = [
      ...(topCount ? [this.countRow(palette, window.start, "earlier")] : []),
      ...pairs,
      ...(bottomCount ? [this.countRow(palette, this.messages.length - window.end, "later")] : []),
    ];
    // A history shorter than the viewport hugs the hint strip: a message
    // stream reads bottom-anchored, and the spare air sits under the
    // heading instead of opening a hole above the hint.
    if (!topCount && !bottomCount) {
      while (lines.length < rows) lines.unshift(railRow(palette, "", palette.bgBase));
    } else {
      while (lines.length < rows) lines.push(railRow(palette, "", palette.bgBase));
    }
    return lines.slice(0, rows);
  }

  private countRow(palette: Palette, count: number, direction: "earlier" | "later"): string {
    return railRow(palette, `${palette.meta}… ${count} ${direction}${RST}`, palette.bgBase);
  }

  private messageRows(index: number, focused: boolean, palette: Palette, now: number): string[] {
    const message = this.messages[index]!;
    const selected = message.id === this.selectedId;
    const marker = this.markerCell(message, selected, focused, palette, now);
    const ordinal = clip(String(message.index), 3).padStart(3);
    const time = formatTime(message.timestamp).padEnd(5);
    const meta = `${palette.meta}${ordinal} ${time} ${RST}`;
    const text = this.summaryLines(message);
    const color = this.textColor(message, index, selected, palette, now);
    const background = selected ? palette.bgSelected : palette.bgBase;
    const first = `${marker}${meta}${color}${text[0]}${RST}`;
    const second = `${" ".repeat(META_CELLS)}${color}${text[1]}${RST}`;
    return [
      railRow(palette, first, background),
      railRow(palette, second, background),
    ];
  }

  /** Selection marker, or a pulsing dot while the summary is still in flight. */
  private markerCell(message: UserMessage, selected: boolean, focused: boolean, palette: Palette, now: number): string {
    if (this.options.isPending(message.id)) {
      if (palette.truecolor && palette.dotDim && palette.dotPeak) {
        return `${fgRgb(rgbLerp(palette.dotDim, palette.dotPeak, pulse(now, 0)))}${DOT_GLYPH}${RST}`;
      }
      const step = Math.round(pulse(now, 0) * (palette.dotFallback.length - 1));
      return `${palette.dotFallback[step] ?? palette.meta}${DOT_GLYPH}${RST}`;
    }
    if (selected && focused) return `${palette.accent}›${RST}`;
    return " ";
  }

  /** Age fade like pi-recap: newest bright, recent normal, older muted; a
   *  landing summary sweeps accent then bold accent before settling. */
  private textColor(message: UserMessage, index: number, selected: boolean, palette: Palette, now: number): string {
    const has = this.options.hasSummary(message.id);
    const was = this.seenSummary.get(message.id);
    if (has && was === false) this.landedAt.set(message.id, now);
    this.seenSummary.set(message.id, has);

    const landed = this.landedAt.get(message.id);
    if (has && landed !== undefined) {
      const phase = settlePhase(now, landed);
      if (phase === 1) return palette.accent;
      if (phase === 2) return palette.bold(palette.accent);
    }
    if (selected) return palette.textNew;
    if (!has) return palette.preview;
    const distance = this.messages.length - 1 - index;
    if (distance === 0) return palette.textNew;
    if (distance <= FRESH_WINDOW) return palette.textMid;
    return palette.textOld;
  }

  /** The summary wrapped into the two text cells of a message slot. */
  private summaryLines(message: UserMessage): [string, string] {
    const wrapped = wrapText(this.options.getSummary(message.id, message.text), TEXT_CELLS);
    if (wrapped.length <= 1) return [wrapped[0] ?? "", ""];
    const second = wrapped.length > 2
      ? clip(wrapped.slice(1).join(" "), TEXT_CELLS)
      : wrapped[1]!;
    return [wrapped[0]!, second];
  }

  /**
   * Fits the message window into `rows`, then shrinks it again to make room
   * for the ellipsis rows that count what stays hidden. Two passes always
   * converge: each pass only removes slots, so the hidden counts can grow
   * but the indicator count cannot exceed two.
   */
  private resolveWindow(rows: number): { start: number; end: number } {
    const total = this.messages.length;
    const selected = this.selectedIndex();
    let slots = Math.floor(rows / ROWS_PER_MESSAGE);
    let window = this.windowFor(slots, selected);
    for (let pass = 0; pass < 3; pass++) {
      const indicators = (window.start > 0 ? 1 : 0) + (window.end < total ? 1 : 0);
      const next = Math.floor((rows - indicators) / ROWS_PER_MESSAGE);
      if (next === slots) break;
      slots = next;
      window = this.windowFor(slots, selected);
    }
    if (slots === 0 && Math.floor(rows / ROWS_PER_MESSAGE) >= 1) {
      // One visible message beats a second ellipsis row.
      window = this.windowFor(1, selected);
    }
    this.viewportStartId = this.messages[window.start]?.id ?? null;
    return window;
  }

  private windowFor(slots: number, selected: number): { start: number; end: number } {
    if (slots >= this.messages.length) return { start: 0, end: this.messages.length };
    let start = this.followTail
      ? this.messages.length - slots
      : Math.min(this.startForSelection(slots, selected), this.messages.length - slots);
    // Browsing within the current window keeps the window stable instead of
    // re-pinning the selection to the top on every step.
    const preserved = this.indexForId(this.viewportStartId);
    if (!this.followTail && preserved >= 0 && selected >= preserved && selected - preserved < slots) {
      start = preserved;
    }
    // A grow or a compaction can leave the preserved anchor beyond the new
    // list; an unclamped start would run the window past the last message.
    start = Math.max(0, Math.min(start, this.messages.length - slots));
    return { start, end: start + slots };
  }

  private startForSelection(slots: number, selected: number): number {
    return Math.max(0, Math.min(selected, this.messages.length - slots));
  }

  // --- detail view ---------------------------------------------------------

  private renderDetail(messageId: string, rows: number, palette: Palette): string[] {
    const message = this.messages[this.indexForId(messageId)];
    if (!message) {
      // The message left the branch under an open detail. Fill the section:
      // returning a single row would surface as a fatal height mismatch.
      const lines = [railRow(palette, `${palette.preview}Message unavailable${RST}`, palette.bgBase)];
      while (lines.length < rows) lines.push(railRow(palette, "", palette.bgBase));
      return lines;
    }
    this.lastDetailRows = rows;
    const wrapped = this.wrappedDetail(message);
    const size = `${palette.meta}${formatCount(message.text.length)} chars · ${wrapped.length} lines${RST}`;
    const head = `#${message.index} ${formatTime(message.timestamp)}`;
    const gap = Math.max(1, RAIL_CONTENT - visibleWidth(head) - visibleWidth(`${formatCount(message.text.length)} chars · ${wrapped.length} lines`));
    const header = railRow(palette, `${palette.meta}${head}${RST}${" ".repeat(gap)}${size}`, palette.bgRaised);
    const { textCapacity, hasIndicator, maxScroll } = detailCapacity(rows, wrapped.length);
    this.detailScroll = Math.max(0, Math.min(this.detailScroll, maxScroll));
    const visible = wrapped.slice(this.detailScroll, this.detailScroll + textCapacity);
    const lines = [header, ...visible.map((line) => railRow(palette, `${palette.textMid}${line}${RST}`, palette.bgRaised))];
    if (hasIndicator) {
      const position = visible.length > 0
        ? `${this.detailScroll + 1}-${this.detailScroll + visible.length} of ${wrapped.length}`
        : `line ${Math.min(this.detailScroll + 1, wrapped.length)} of ${wrapped.length}`;
      lines.push(railRow(palette, `${palette.meta}${position} · ↑↓ scroll${RST}`, palette.bgRaised));
    }
    while (lines.length < rows) lines.push(railRow(palette, "", palette.bgRaised));
    return lines.slice(0, rows);
  }

  /** Wrapping is O(message length); a detail stays open across many keystrokes and renders. */
  private wrappedDetail(message: UserMessage): string[] {
    if (this.wrapCache?.id !== message.id) {
      this.wrapCache = { id: message.id, lines: wrapText(message.text, RAIL_CONTENT) };
    }
    return this.wrapCache.lines;
  }

  private handleDetailInput(data: string): void {
    const message = this.messages[this.indexForId(this.detailId)];
    if (!message) { this.detailId = null; return; }
    const wrapped = this.wrappedDetail(message);
    const { maxScroll } = detailCapacity(this.lastDetailRows, wrapped.length);
    if (matchesKey(data, "up") || matchesKey(data, "pageUp")) {
      this.detailScroll = Math.max(0, this.detailScroll - (matchesKey(data, "pageUp") ? 10 : 1));
    } else if (matchesKey(data, "down") || matchesKey(data, "pageDown")) {
      this.detailScroll = Math.min(maxScroll, this.detailScroll + (matchesKey(data, "pageDown") ? 10 : 1));
    } else return;
    this.options.requestRefresh();
  }

  // --- state helpers -------------------------------------------------------

  private selectedIndex(): number {
    if (this.messages.length === 0) return -1;
    const index = this.indexForId(this.selectedId);
    return index >= 0 ? index : this.messages.length - 1;
  }

  private indexForId(id: string | null): number {
    return id ? this.messages.findIndex((message) => message.id === id) : -1;
  }
}

