import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { GLOW_MS, isArriving, isSettling } from "./anim.ts";
import type { Palette } from "./palette.ts";
import { RAIL_CONTENT, ghostHeader, railRow } from "./sections.ts";
import { RST, formatCount, formatTime, wrapText } from "./style.ts";
import { slotRows } from "./slots.ts";
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

/** One message always occupies a two-row slot: summary line plus its wrap. */
const ROWS_PER_MESSAGE = 2;
const SETUP_HINT = "AI summaries need FORNACE_LLM_API_KEY";

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
  private readonly arrivedAt = new Map<string, number>();
  /** Ids seen so far; the first updateMessages seeds history without animating
   *  it, so a resumed session loads calm and only live arrivals reveal. */
  private readonly known = new Set<string>();

  constructor(
    private readonly options: MessagePanelOptions,
    messages: UserMessage[],
  ) {
    this.messages = messages;
    this.selectedId = messages.at(-1)?.id ?? null;
    for (const message of messages) this.known.add(message.id);
  }

  getSelectedMessageId(): string | null { return this.selectedId; }
  isFollowingTail(): boolean { return this.followTail; }

  /** Full prompt text of the selected message, for the focused rail's copy key. */
  selectedMessageText(): string | null {
    return this.messages.find((message) => message.id === this.selectedId)?.text ?? null;
  }
  isExpanded(messageId: string): boolean { return this.detailId === messageId; }
  isDetailOpen(): boolean { return this.detailId !== null; }

  updateMessages(messages: UserMessage[]): void {
    const previousId = this.selectedId;
    const previousStartId = this.viewportStartId;
    this.messages = messages;
    for (const message of messages) {
      if (!this.known.has(message.id)) {
        this.known.add(message.id);
        this.arrivedAt.set(message.id, Date.now());
      }
    }
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
      if (isSettling(now, at) || now - at < GLOW_MS) return true;
      if (now - at > 5000) this.landedAt.delete(id);
    }
    for (const [id, at] of this.arrivedAt) {
      if (isArriving(now, at)) return true;
      if (now - at > 5000) this.arrivedAt.delete(id);
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
      return [heading, ...detail, this.hintRow(palette, scrollable ? "[Esc] back  [↑↓] scroll" : "[Esc] back")].slice(0, rows);
    }

    // The setup hint replaces the spacer row under the heading; a message
    // slot is never sacrificed for it. An air row opens the section so every
    // ghost header sits one row below the content above it.
    const showSetupHint = !this.options.summariesConfigured() && rows >= 6;
    const spacer = rows >= (showSetupHint ? 7 : 6);
    const consumed = 2 + (showSetupHint ? 1 : 0) + (spacer ? 1 : 0) + 2;
    const viewportRows = Math.max(2, rows - consumed);
    const sections = [
      railRow(palette, "", palette.bgDeep),
      heading,
      ...(showSetupHint ? [railRow(palette, `${palette.ghostBright}${SETUP_HINT}${RST}`, palette.bgDeep)] : []),
      ...(spacer ? [railRow(palette, "", palette.bgDeep)] : []),
      ...this.renderViewport(viewportRows, focused, palette, now),
      this.hintRow(palette, focused ? "[↑↓] select  [↵] open  [c] copy" : "[Ctrl+Shift+H] focus"),
      this.hintRow(palette, "[Ctrl+Shift+S] footer"),
    ];
    while (sections.length < rows) sections.push(railRow(palette, "", palette.bgDeep));
    return sections.slice(0, rows);
  }

  // --- list rendering ------------------------------------------------------

  private headingRow(palette: Palette, label: string, right: string): string {
    return ghostHeader(palette, label, palette.bgDeep, right);
  }

  private hintRow(palette: Palette, text: string): string {
    return railRow(palette, `${palette.ghost}${text}${RST}`, palette.bgPanel);
  }

  /** Always returns exactly `rows` lines: ellipsis rows, message pairs, padding. */
  private renderViewport(rows: number, focused: boolean, palette: Palette, now: number): string[] {
    if (this.messages.length === 0) {
      const empty = [railRow(palette, `${palette.ghost}No messages yet${RST}`, palette.bgDeep)];
      while (empty.length < rows) empty.push(railRow(palette, "", palette.bgDeep));
      return empty;
    }

    const window = this.resolveWindow(rows);
    const pairs: string[] = [];
    for (let index = window.start; index < window.end; index++) {
      pairs.push(...this.messageRows(index, palette, now));
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
      while (lines.length < rows) lines.unshift(railRow(palette, "", palette.bgDeep));
    } else {
      while (lines.length < rows) lines.push(railRow(palette, "", palette.bgDeep));
    }
    return lines.slice(0, rows);
  }

  private countRow(palette: Palette, count: number, direction: "earlier" | "later"): string {
    return railRow(palette, `${palette.ghost}… ${count} ${direction}${RST}`, palette.bgDeep);
  }

  private messageRows(index: number, palette: Palette, now: number): string[] {
    const message = this.messages[index]!;
    return slotRows(message, index, this.messages.length, message.id === this.selectedId, palette, now, {
      getSummary: this.options.getSummary,
      hasSummary: this.options.hasSummary,
      isPending: this.options.isPending,
    }, {
      seenSummary: this.seenSummary,
      landedAt: this.landedAt,
      arrivedAt: this.arrivedAt,
    });
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
      const lines = [railRow(palette, `${palette.ghost}Message unavailable${RST}`, palette.bgDeep)];
      while (lines.length < rows) lines.push(railRow(palette, "", palette.bgDeep));
      return lines;
    }
    this.lastDetailRows = rows;
    const wrapped = this.wrappedDetail(message);
    const size = `${palette.ghostBright}${formatCount(message.text.length)} chars · ${wrapped.length} lines${RST}`;
    const head = `#${message.index} ${formatTime(message.timestamp)}`;
    const gap = Math.max(1, RAIL_CONTENT - visibleWidth(head) - visibleWidth(`${formatCount(message.text.length)} chars · ${wrapped.length} lines`));
    const header = railRow(palette, `${palette.ghostBright}${head}${RST}${" ".repeat(gap)}${size}`, palette.bgPanel);
    const { textCapacity, hasIndicator, maxScroll } = detailCapacity(rows, wrapped.length);
    this.detailScroll = Math.max(0, Math.min(this.detailScroll, maxScroll));
    const visible = wrapped.slice(this.detailScroll, this.detailScroll + textCapacity);
    const lines = [header, ...visible.map((line) => railRow(palette, `${palette.textMid}${line}${RST}`, palette.bgPanel))];
    if (hasIndicator) {
      const position = visible.length > 0
        ? `${this.detailScroll + 1}-${this.detailScroll + visible.length} of ${wrapped.length}`
        : `line ${Math.min(this.detailScroll + 1, wrapped.length)} of ${wrapped.length}`;
      lines.push(railRow(palette, `${palette.ghost}${position} · ↑↓ scroll${RST}`, palette.bgPanel));
    }
    while (lines.length < rows) lines.push(railRow(palette, "", palette.bgPanel));
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

