import {
  copyToClipboard,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CmuxContext } from "./cmux.ts";
import { SIDEBAR_WIDTH } from "./constants.ts";
import { readSessionGoal } from "./goal.ts";
import { assertLinesFit } from "./layout.ts";
import {
  RAIL_CONTENT,
  railFill,
  renderGoalSection,
  renderRuntimeSection,
  renderSessionSection,
  railRow,
  ruleRow,
} from "./sections.ts";
import {
  BG,
  BG_DETAIL,
  BG_HINT,
  BG_SEL,
  BOLD,
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

type SidebarOptions = {
  tui: TUI;
  ctx: ExtensionContext;
  getFooterData: () => ReadonlyFooterDataProvider | null;
  getThinkingLevel: () => string;
  getCmuxContext: () => CmuxContext | null;
  getTitle: (messageId: string, text: string) => string;
  messages: UserMessage[];
};

type Layout = { goal: number; session: number; runtime: number; messages: number };

const RULE_ROWS = 3;
/** Rows a section cannot render without losing content it is required to show. */
const MANDATORY = {
  /** blank + GOAL + title + status + budget; the no-goal state is GOAL + guidance. */
  goal: (hasGoal: boolean) => (hasGoal ? 5 : 3),
  /** label + surface/workspace + cwd. */
  session: 3,
  /** heading + one message + hint. */
  messages: 3,
  /** model route + ctx/cost. */
  runtime: 2,
} as const;

/** Smallest terminal that can hold every mandatory row; below it the rail shows a notice. */
export function minimumHeight(hasGoal: boolean): number {
  return MANDATORY.goal(hasGoal) + MANDATORY.session + MANDATORY.messages + MANDATORY.runtime + RULE_ROWS;
}

/**
 * Mandatory rows first, then optional rows in priority order, then every
 * remaining row to the message viewport. Returns null when the mandatory
 * budget does not fit, so the caller renders a notice instead of silently
 * slicing content away.
 */
function allocate(height: number, hasGoal: boolean): Layout | null {
  if (height < minimumHeight(hasGoal)) return null;

  let goal = MANDATORY.goal(hasGoal);
  let session = MANDATORY.session;
  let runtime = MANDATORY.runtime;
  let spare = height - minimumHeight(hasGoal);

  const grow = (rows: number, take: (granted: number) => void) => {
    const granted = Math.min(rows, spare);
    if (granted <= 0) return;
    take(granted);
    spare -= granted;
  };
  grow(1, (granted) => { session += granted; });        // branch · session id
  if (hasGoal) grow(4, (granted) => { goal += granted; }); // second title line and spacing
  grow(1, (granted) => { runtime += granted; });        // trailing breath under the runtime rows

  return { goal, session, runtime, messages: MANDATORY.messages + spare };
}

/** Cells the selection marker occupies in front of a message title. */
const MESSAGE_PREFIX_CELLS = 2;

function detailCapacity(rows: number, wrappedCount: number): { textCapacity: number; hasIndicator: boolean; maxScroll: number } {
  const available = Math.max(0, rows - 1);
  if (wrappedCount <= available) {
    return { textCapacity: available, hasIndicator: false, maxScroll: 0 };
  }
  const textCapacity = Math.max(1, available - 1);
  const maxScroll = Math.max(0, wrappedCount - textCapacity);
  return { textCapacity, hasIndicator: true, maxScroll };
}

export class SidebarComponent implements Component {
  private focused = false;
  private selectedId: string | null;
  private detailId: string | null = null;
  private detailScroll = 0;
  private lastDetailRows = 1;
  private followTail = true;
  private messages: UserMessage[];
  private version = 0;
  private restoreFocus: Component | null = null;
  private cachedSignature = "";
  private cachedLines: string[] = [];
  private viewportStartId: string | null = null;
  private wrapCache: { id: string; lines: string[] } | null = null;

  constructor(private readonly options: SidebarOptions) {
    this.messages = options.messages;
    this.selectedId = this.messages.at(-1)?.id ?? null;
  }

  isFocused(): boolean { return this.focused; }
  getSelectedMessageId(): string | null { return this.selectedId; }
  isFollowingTail(): boolean { return this.followTail; }
  isExpanded(messageId: string): boolean { return this.detailId === messageId; }
  isDetailOpen(): boolean { return this.detailId !== null; }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    if (focused) {
      this.restoreFocus = (this.options.tui as any).getFocusedComponent?.() ?? null;
      this.focused = true;
      this.options.tui.setFocus(this);
    } else {
      this.focused = false;
      this.detailId = null;
      if ((this.options.tui as any).getFocusedComponent?.() === this) this.options.tui.setFocus(this.restoreFocus);
      this.restoreFocus = null;
    }
    this.refresh();
  }

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
    this.refresh();
  }

  refresh(): void {
    this.version++;
    this.options.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      if (this.detailId) { this.detailId = null; this.detailScroll = 0; this.refresh(); return; }
      return this.setFocused(false);
    }
    if (this.detailId) return this.handleDetailInput(data);
    if (matchesKey(data, "c")) { void this.copySessionPath(); return; }
    const current = this.selectedIndex();
    let target: number | null = null;
    if (matchesKey(data, "up")) target = Math.max(0, current - 1);
    else if (matchesKey(data, "down")) target = Math.min(this.messages.length - 1, current + 1);
    else if (matchesKey(data, "pageUp")) target = Math.max(0, current - 10);
    else if (matchesKey(data, "pageDown")) target = Math.min(this.messages.length - 1, current + 10);
    else if (matchesKey(data, "home")) target = 0;
    else if (matchesKey(data, "end")) target = Math.max(0, this.messages.length - 1);
    else if (matchesKey(data, "return") || matchesKey(data, "enter") || data === " ") {
      if (this.selectedId) { this.detailId = this.selectedId; this.detailScroll = 0; this.refresh(); }
      return;
    } else return;

    if (target < 0 || !this.messages[target]) return;
    this.selectedId = this.messages[target].id;
    this.followTail = target === this.messages.length - 1;
    if (this.followTail) this.viewportStartId = null;
    this.refresh();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.min(SIDEBAR_WIDTH, width));
    const targetHeight = Math.max(1, this.options.tui.terminal.rows);
    const signature = this.signature(safeWidth, targetHeight);
    if (signature === this.cachedSignature) return this.cachedLines;

    const hasGoal = readSessionGoal(this.options.ctx) !== null;
    const layout = safeWidth < SIDEBAR_WIDTH ? null : allocate(targetHeight, hasGoal);
    const result = layout
      ? this.renderRail(safeWidth, targetHeight, layout)
      : this.renderNotice(safeWidth, targetHeight, hasGoal);
    assertLinesFit(result, safeWidth, "sidebar");
    if (result.length !== targetHeight) {
      throw new Error(`sidebar height mismatch (${result.length} != ${targetHeight})`);
    }
    this.cachedSignature = signature;
    this.cachedLines = result;
    return result;
  }

  invalidate(): void {
    this.cachedSignature = "";
    this.cachedLines = [];
  }

  // --- rail ---------------------------------------------------------------

  private renderRail(_width: number, height: number, layout: Layout): string[] {
    const ctx = this.options.ctx;
    const lines: string[] = [];
    lines.push(...renderGoalSection(readSessionGoal(ctx), layout.goal));
    lines.push(ruleRow());
    lines.push(...renderSessionSection(ctx, this.options.getFooterData(), this.options.getCmuxContext(), layout.session));
    lines.push(ruleRow());
    lines.push(...this.renderMessages(layout.messages));
    lines.push(ruleRow());
    lines.push(...renderRuntimeSection(ctx, this.options.getFooterData(), this.options.getThinkingLevel(), layout.runtime));
    return lines.slice(0, height);
  }

  /** Bounded to the width actually offered, so a narrow slot never overflows its column. */
  private renderNotice(width: number, height: number, hasGoal: boolean): string[] {
    const row = (text: string) =>
      width <= 1 ? fillRow("", width, BG) : `${FG_FAINT}│${RST}${fillRow(` ${text}`, width - 1, BG)}`;
    const lines = [
      row(`${BOLD}${FG_BRIGHT}Sidebar${RST}`),
      row(`${FG_DIM}needs ${SIDEBAR_WIDTH}×${minimumHeight(hasGoal)}${RST}`),
    ];
    while (lines.length < height) lines.push(row(""));
    return lines.slice(0, height);
  }

  // --- messages -----------------------------------------------------------

  private renderMessages(rows: number): string[] {
    const total = this.messages.length;
    const detailIndex = this.detailId ? this.indexForId(this.detailId) : -1;
    const position = detailIndex >= 0 ? detailIndex + 1 : this.selectedIndex() + 1;
    const heading = this.detailId
      ? this.headingRow("MESSAGE", `${position}/${total}`)
      : this.headingRow("MESSAGES", total > 0 ? `${position}/${total}` : "0/0");

    if (this.detailId) {
      const detail = this.renderDetail(this.detailId, Math.max(1, rows - 2));
      return [heading, ...detail, this.hintRow("Esc back · ↑↓ scroll")].slice(0, rows);
    }

    const blank = rows >= 4;
    const viewportRows = Math.max(1, rows - (blank ? 3 : 2));
    const viewport = this.renderViewport(viewportRows);
    const sections = [heading, ...(blank ? [railRow("", BG)] : []), ...viewport, this.hintRow(this.focused ? "↑↓ select · Enter open · c copy" : "Ctrl+Shift+H focus")];
    while (sections.length < rows) sections.splice(sections.length - 1, 0, railRow("", BG));
    return sections.slice(0, rows);
  }

  private headingRow(label: string, right: string): string {
    const leftWidth = visibleWidth(label);
    const gap = Math.max(1, RAIL_CONTENT - leftWidth - visibleWidth(right));
    return railRow(`${FG_SECONDARY}${label}${RST}${" ".repeat(gap)}${FG_FAINT}${right}${RST}`, BG);
  }

  private hintRow(text: string): string {
    return railRow(`${FG_DIM}${text}${RST}`, BG_HINT);
  }

  private renderViewport(rows: number): string[] {
    if (this.messages.length === 0) return [railRow(`${FG_DIM}No messages yet${RST}`, BG)];

    const selected = this.selectedIndex();
    let start = this.followTail
      ? this.tailStart(rows)
      : Math.min(this.startForSelection(rows, selected), Math.max(0, this.messages.length - rows));
    const preserved = this.indexForId(this.viewportStartId);
    if (!this.followTail && preserved >= 0 && selected >= preserved && this.rangeFits(preserved, selected, rows)) start = preserved;
    start = Math.max(0, Math.min(start, Math.max(0, this.messages.length - rows)));

    const lines: string[] = [];
    for (let index = start; index < this.messages.length && lines.length < rows; index++) {
      lines.push(this.renderMessageRow(index));
    }
    this.viewportStartId = this.messages[start]?.id ?? null;
    while (lines.length < rows) lines.push(railRow("", BG));
    return lines;
  }

  private renderMessageRow(index: number): string {
    const message = this.messages[index]!;
    const selected = message.id === this.selectedId;
    const title = this.options.getTitle(message.id, message.text);
    const prefix = selected && this.focused ? `${FG_ACC}›${RST} ` : "  ";
    const titleWidth = RAIL_CONTENT - MESSAGE_PREFIX_CELLS;
    const body = `${selected ? FG_BRIGHT : FG_PRIMARY}${truncateToWidth(title, titleWidth, "…")}${RST}`;
    return `${FG_FAINT}│${RST}${fillRow(` ${prefix}${body}`, railFill(), selected ? BG_SEL : BG)}`;
  }

  private renderDetail(messageId: string, rows: number): string[] {
    const message = this.messages[this.indexForId(messageId)];
    if (!message) return [railRow(`${FG_DIM}Message unavailable${RST}`, BG)];
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
    this.refresh();
  }

  // --- viewport math --------------------------------------------------------

  private tailStart(rows: number): number {
    let start = this.messages.length - 1;
    while (start > 0 && this.messages.length - start < rows) start--;
    return start;
  }

  private startForSelection(rows: number, selected: number): number {
    return Math.max(0, Math.min(selected, this.messages.length - rows));
  }

  private rangeFits(start: number, selected: number, rows: number): boolean {
    return selected - start < rows;
  }

  private selectedIndex(): number {
    if (this.messages.length === 0) return -1;
    const index = this.indexForId(this.selectedId);
    return index >= 0 ? index : this.messages.length - 1;
  }

  private indexForId(id: string | null): number {
    return id ? this.messages.findIndex((message) => message.id === id) : -1;
  }

  private signature(width: number, height: number): string {
    const usage = this.options.ctx.getContextUsage?.();
    const statuses = this.options.getFooterData()?.getExtensionStatuses();
    const goal = readSessionGoal(this.options.ctx);
    const cmux = this.options.getCmuxContext();
    return JSON.stringify({
      width,
      height,
      version: this.version,
      model: this.options.ctx.model?.id,
      thinking: this.options.getThinkingLevel(),
      usage,
      statuses: statuses && typeof (statuses as any).entries === "function" ? [...statuses.entries()] : [],
      goal: goal ? `${goal.goalId}:${goal.status}:${goal.usage.tokensUsed}:${goal.usage.activeSeconds}:${goal.updatedAt}` : null,
      cmux: cmux ? `${cmux.workspaceTitle}:${cmux.workspaceRef}:${cmux.surfaceRef}` : null,
    });
  }

  private async copySessionPath(): Promise<void> {
    const target = this.options.ctx.sessionManager.getSessionFile() ?? this.options.ctx.sessionManager.getSessionId();
    try {
      await copyToClipboard(target);
      this.options.ctx.ui.notify(`Copied ${basename(target)}`, "info");
    } catch {
      this.options.ctx.ui.notify(`Session path: ${target}`, "warning");
    }
  }
}
