import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { RAIL_CONTENT, railFill, railRow } from "./sections.ts";
import {
  BG,
  BG_DETAIL,
  BG_HINT,
  BG_SEL,
  FG_ACC,
  FG_BRIGHT,
  FG_DIM,
  FG_EXP,
  FG_FAINT,
  FG_PRIMARY,
  FG_SECONDARY,
  RST,
  fillRow,
  formatTime,
  wrapText,
} from "./style.ts";
import type { UserMessage } from "./types.ts";

export type { UserMessage };

type MessagePanelOptions = {
  /** Display summary for a message: model summary when present, preview otherwise. */
  getSummary: (messageId: string, text: string) => string;
  /** Whether the model has written this message's summary yet (dims the preview). */
  hasSummary: (messageId: string) => boolean;
  /** Whether the summary gateway is configured at all (shows the setup hint). */
  summariesConfigured: () => boolean;
  requestRefresh: () => void;
};

/** Cells in front of the summary text: marker, ordinal, space, time, space. */
const META_CELLS = 10;
const TEXT_CELLS = RAIL_CONTENT - META_CELLS;
/** One message always occupies a two-row slot: summary line plus its wrap. */
const ROWS_PER_MESSAGE = 2;
const SETUP_HINT = "AI summaries need FORNACE_LLM_API_KEY";

export function detailCapacity(rows: number, wrappedCount: number): { textCapacity: number; hasIndicator: boolean; maxScroll: number } {
  const available = Math.max(0, rows - 1);
  if (wrappedCount <= available) {
    return { textCapacity: available, hasIndicator: false, maxScroll: 0 };
  }
  const textCapacity = Math.max(1, available - 1);
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

  /** Renders exactly `rows` lines: heading, optional setup hint, viewport, hint strip. */
  renderSection(rows: number, focused: boolean): string[] {
    const total = this.messages.length;
    const detailIndex = this.detailId ? this.indexForId(this.detailId) : -1;
    const position = detailIndex >= 0 ? detailIndex + 1 : this.selectedIndex() + 1;
    const heading = this.headingRow(
      this.detailId ? "MESSAGE" : "MESSAGES",
      total > 0 || this.detailId ? `${position}/${total}` : `0/${total}`,
    );

    if (this.detailId) {
      const detailRows = Math.max(1, rows - 2);
      const detail = this.renderDetail(this.detailId, detailRows);
      // Only offer scrolling when there is something below the fold.
      const message = this.messages[this.indexForId(this.detailId)];
      const scrollable = message !== undefined
        && detailCapacity(detailRows, this.wrappedDetail(message).length).hasIndicator;
      return [heading, ...detail, this.hintRow(scrollable ? "Esc back · ↑↓ scroll" : "Esc back")];
    }

    // The setup hint replaces the spacer row under the heading; a message
    // slot is never sacrificed for it.
    const showSetupHint = !this.options.summariesConfigured() && rows >= 5;
    const spacer = rows >= (showSetupHint ? 6 : 5);
    const consumed = 1 + (showSetupHint ? 1 : 0) + (spacer ? 1 : 0) + 1;
    const viewportRows = Math.max(2, rows - consumed);
    const sections = [
      heading,
      ...(showSetupHint ? [railRow(`${FG_FAINT}${SETUP_HINT}${RST}`, BG)] : []),
      ...(spacer ? [railRow("", BG)] : []),
      ...this.renderViewport(viewportRows, focused),
      this.hintRow(focused ? "↑↓ select · Enter open · c copy" : "Ctrl+Shift+H focus"),
    ];
    while (sections.length < rows) sections.push(railRow("", BG));
    return sections.slice(0, rows);
  }

  // --- list rendering ------------------------------------------------------

  private headingRow(label: string, right: string): string {
    const leftWidth = visibleWidth(label);
    const gap = Math.max(1, RAIL_CONTENT - leftWidth - visibleWidth(right));
    return railRow(`${FG_SECONDARY}${label}${RST}${" ".repeat(gap)}${FG_FAINT}${right}${RST}`, BG);
  }

  private hintRow(text: string): string {
    return railRow(`${FG_DIM}${text}${RST}`, BG_HINT);
  }

  /** Always returns exactly `rows` lines: ellipsis rows, message pairs, padding. */
  private renderViewport(rows: number, focused: boolean): string[] {
    if (this.messages.length === 0) {
      const empty = [railRow(`${FG_DIM}No messages yet${RST}`, BG)];
      while (empty.length < rows) empty.push(railRow("", BG));
      return empty;
    }

    const window = this.resolveWindow(rows);
    const pairs: string[] = [];
    for (let index = window.start; index < window.end; index++) {
      pairs.push(...this.messageRows(index, focused));
    }
    // A message pair outranks an ellipsis row when both cannot fit.
    const topCount = window.start > 0 && 1 + pairs.length <= rows;
    const bottomCount = window.end < this.messages.length && (topCount ? 2 : 1) + pairs.length <= rows;
    const lines = [
      ...(topCount ? [this.countRow(window.start, "earlier")] : []),
      ...pairs,
      ...(bottomCount ? [this.countRow(this.messages.length - window.end, "later")] : []),
    ];
    while (lines.length < rows) lines.push(railRow("", BG));
    return lines.slice(0, rows);
  }

  private countRow(count: number, direction: "earlier" | "later"): string {
    return railRow(`${FG_FAINT}… ${count} ${direction}${RST}`, BG);
  }

  private messageRows(index: number, focused: boolean): string[] {
    const message = this.messages[index]!;
    const selected = message.id === this.selectedId;
    const marker = selected && focused ? `${FG_ACC}›${RST}` : " ";
    const ordinal = truncateToWidth(String(message.index), 2, "…").padStart(2);
    const time = formatTime(message.timestamp).padEnd(5);
    const meta = `${FG_FAINT}${ordinal} ${time} ${RST}`;
    const text = this.summaryLines(message);
    const color = selected ? FG_BRIGHT : this.options.hasSummary(message.id) ? FG_PRIMARY : FG_DIM;
    const background = selected ? BG_SEL : BG;
    const first = `${marker}${meta}${color}${text[0]}${RST}`;
    const second = `${" ".repeat(META_CELLS)}${color}${text[1]}${RST}`;
    return [
      `${FG_FAINT}│${RST}${fillRow(` ${first}`, railFill(), background)}`,
      `${FG_FAINT}│${RST}${fillRow(` ${second}`, railFill(), background)}`,
    ];
  }

  /** The summary wrapped into the two text cells of a message slot. */
  private summaryLines(message: UserMessage): [string, string] {
    const wrapped = wrapText(this.options.getSummary(message.id, message.text), TEXT_CELLS);
    if (wrapped.length <= 1) return [wrapped[0] ?? "", ""];
    const second = wrapped.length > 2
      ? truncateToWidth(wrapped.slice(1).join(" "), TEXT_CELLS, "…")
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
    return { start, end: start + slots };
  }

  private startForSelection(slots: number, selected: number): number {
    return Math.max(0, Math.min(selected, this.messages.length - slots));
  }

  // --- detail view ---------------------------------------------------------

  private renderDetail(messageId: string, rows: number): string[] {
    const message = this.messages[this.indexForId(messageId)];
    if (!message) {
      // The message left the branch under an open detail. Fill the section:
      // returning a single row would surface as a fatal height mismatch.
      const lines = [railRow(`${FG_DIM}Message unavailable${RST}`, BG)];
      while (lines.length < rows) lines.push(railRow("", BG));
      return lines;
    }
    this.lastDetailRows = rows;
    const header = railRow(`${FG_FAINT}#${message.index} ${formatTime(message.timestamp)}${RST}`, BG);
    const wrapped = this.wrappedDetail(message);
    const { textCapacity, hasIndicator, maxScroll } = detailCapacity(rows, wrapped.length);
    this.detailScroll = Math.max(0, Math.min(this.detailScroll, maxScroll));
    const visible = wrapped.slice(this.detailScroll, this.detailScroll + textCapacity);
    const lines = [header, ...visible.map((line) => railRow(`${FG_EXP}${line}${RST}`, BG_DETAIL))];
    if (hasIndicator) {
      const first = visible.length > 0 ? this.detailScroll + 1 : 0;
      const last = this.detailScroll + visible.length;
      lines.push(railRow(`${FG_DIM}${first}-${last} of ${wrapped.length} · ↑↓ scroll${RST}`, BG_DETAIL));
    }
    while (lines.length < rows) lines.push(railRow("", BG_DETAIL));
    return lines;
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
