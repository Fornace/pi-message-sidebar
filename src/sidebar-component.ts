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
import { renderStatusDock } from "./status-dock.ts";
import {
  BG,
  BG_HDR,
  BG_SEL,
  BOLD,
  DIM,
  FG_ACC,
  FG_BRIGHT,
  FG_DIM,
  FG_EXP,
  FG_FAINT,
  FG_MID,
  FG_NORM,
  FG_TIME,
  RST,
  fillRow,
  formatTime,
  wrapText,
} from "./style.ts";

export type UserMessage = { id: string; text: string; index: number; timestamp: string };

type SidebarOptions = {
  tui: TUI;
  ctx: ExtensionContext;
  getFooterData: () => ReadonlyFooterDataProvider | null;
  getThinkingLevel: () => string;
  getCmuxContext: () => CmuxContext | null;
  messages: UserMessage[];
};

export class SidebarComponent implements Component {
  private focused = false;
  private selectedId: string | null;
  private readonly expandedIds = new Set<string>();
  private followTail = true;
  private messages: UserMessage[];
  private version = 0;
  private restoreFocus: Component | null = null;
  private cachedSignature = "";
  private cachedLines: string[] = [];
  private viewportStartId: string | null = null;

  constructor(private readonly options: SidebarOptions) {
    this.messages = options.messages;
    this.selectedId = this.messages.at(-1)?.id ?? null;
  }

  isFocused(): boolean { return this.focused; }
  getSelectedMessageId(): string | null { return this.selectedId; }
  isFollowingTail(): boolean { return this.followTail; }
  isExpanded(messageId: string): boolean { return this.expandedIds.has(messageId); }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    if (focused) {
      this.restoreFocus = (this.options.tui as any).getFocusedComponent?.() ?? null;
      this.focused = true;
      this.options.tui.setFocus(this);
    } else {
      this.focused = false;
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
    for (const id of this.expandedIds) if (!ids.has(id)) this.expandedIds.delete(id);
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
    if (matchesKey(data, "escape")) return this.setFocused(false);
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
      if (!this.selectedId) return;
      if (this.expandedIds.has(this.selectedId)) this.expandedIds.delete(this.selectedId);
      else this.expandedIds.add(this.selectedId);
      this.refresh();
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

    const fullHeader = this.renderHeader(safeWidth);
    const headerRows = this.messages.length > 0 && targetHeight === 1 ? 0 : 1;
    const header = fullHeader.slice(0, Math.min(headerRows, targetHeight));
    const available = Math.max(0, targetHeight - header.length);
    // At tiny heights, keep one chronological message row before allocating dock chrome.
    const messageReserve = this.messages.length > 0 && available > 0 ? 1 : 0;
    const dock = renderStatusDock(
      safeWidth,
      this.options.ctx,
      this.options.getFooterData(),
      this.options.getThinkingLevel(),
      this.focused,
      this.options.getCmuxContext,
      Math.min(5, Math.max(0, available - messageReserve)),
    );
    const bodyHeight = Math.max(0, targetHeight - header.length - dock.length);
    const result = [...header, ...this.renderBody(safeWidth, bodyHeight), ...dock];
    assertLinesFit(result, safeWidth, "sidebar");
    if (result.length !== targetHeight) throw new Error(`sidebar height mismatch (${result.length} != ${targetHeight})`);
    this.cachedSignature = signature;
    this.cachedLines = result;
    return result;
  }

  invalidate(): void {
    this.cachedSignature = "";
    this.cachedLines = [];
  }

  private renderHeader(width: number): string[] {
    const position = this.selectedIndex() + 1;
    const count = this.messages.length;
    const selected = this.messages[this.selectedIndex()];
    const detail = selected ? ` ${FG_FAINT}·${RST} ${FG_DIM}#${selected.index} ${formatTime(selected.timestamp)}${RST}` : "";
    return [
      fillRow(` ${BOLD}${FG_BRIGHT}Messages${RST} ${FG_FAINT}${count > 0 ? `${position}/${count}` : "0"}${RST}${detail}`, width, BG_HDR),
    ];
  }

  private renderBody(width: number, height: number): string[] {
    if (height === 0) return [];
    if (this.messages.length === 0) return this.padBottom([fillRow(` ${FG_DIM}No messages yet${RST}`, width, BG)], height, width);

    const selected = this.selectedIndex();
    let start = this.followTail ? this.tailStart(width, height) : this.startForSelection(width, height, selected);
    const preserved = this.indexForId(this.viewportStartId);
    if (!this.followTail && preserved >= 0 && selected >= preserved && this.rangeFitsSelection(width, height, preserved, selected)) start = preserved;

    const lines: string[] = [];
    for (let index = start; index < this.messages.length && lines.length < height; index++) {
      const remaining = height - lines.length;
      lines.push(...this.renderMessage(index, width, remaining));
    }
    this.viewportStartId = this.messages[start]?.id ?? null;
    return this.padBottom(lines.slice(0, height), height, width);
  }

  private tailStart(width: number, height: number): number {
    let start = this.messages.length - 1;
    let rows = this.messageRowCount(start, width, height);
    while (start > 0) {
      const next = this.messageRowCount(start - 1, width, height);
      if (rows + next > height) break;
      rows += next;
      start--;
    }
    return start;
  }

  private startForSelection(width: number, height: number, selected: number): number {
    let start = selected;
    let rows = this.messageRowCount(selected, width, height);
    while (start > 0) {
      const next = this.messageRowCount(start - 1, width, height);
      if (rows + next > height) break;
      rows += next;
      start--;
    }
    return start;
  }

  private rangeFitsSelection(width: number, height: number, start: number, selected: number): boolean {
    let rows = 0;
    for (let index = start; index <= selected; index++) {
      rows += this.messageRowCount(index, width, height);
      if (rows > height) return false;
    }
    return true;
  }

  private messageRowCount(index: number, width: number, maxRows: number): number {
    return this.renderMessage(index, width, maxRows).length;
  }

  private padBottom(lines: string[], height: number, width: number): string[] {
    const padding = Array.from({ length: Math.max(0, height - lines.length) }, () => fillRow(" ", width, BG));
    return [...lines, ...padding];
  }

  private renderMessage(index: number, width: number, maxRows = Number.MAX_SAFE_INTEGER): string[] {
    const message = this.messages[index]!;
    const selected = message.id === this.selectedId;
    const background = selected ? BG_SEL : BG;
    const arrow = selected && this.focused ? `${FG_ACC}›${RST}` : " ";
    if (!this.expandedIds.has(message.id)) {
      // Collapsed preview: up to two wrapped lines so real prompts stay readable.
      const prefix = ` ${arrow} `;
      const textWidth = Math.max(1, width - visibleWidth(prefix));
      const wrapped = wrapText(message.text, textWidth);
      const rows = Math.max(1, Math.min(2, maxRows));
      const shown = wrapped.slice(0, rows);
      if (wrapped.length > shown.length && shown.length > 0) {
        const overflow = shown[shown.length - 1]!;
        shown[shown.length - 1] = truncateToWidth(overflow, Math.max(1, textWidth - 1), "") + "…";
      }
      return shown.map((line, position) =>
        fillRow(`${position === 0 ? prefix : "   "}${selected ? FG_BRIGHT : FG_NORM}${line}${RST}`, width, background),
      );
    }

    const number = `${FG_FAINT}#${message.index}${RST}`;
    const time = `${FG_TIME}${formatTime(message.timestamp)}${RST}`;
    const lines = [fillRow(` ${arrow} ${number} ${time}`, width, background)];
    const wrapped = wrapText(message.text, Math.max(1, width - 4));
    const contentRows = Math.max(0, maxRows - 1);
    for (const line of wrapped.slice(0, contentRows)) lines.push(fillRow(`   ${FG_EXP}${line}${RST}`, width, background));
    if (wrapped.length > contentRows && lines.length === maxRows) {
      lines[lines.length - 1] = fillRow(`   ${FG_DIM}${DIM}…+${wrapped.length - contentRows + 1} lines${RST}`, width, background);
    }
    return lines;
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
