import {
  copyToClipboard,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { SIDEBAR_WIDTH } from "./constants.ts";
import type { CmuxContext } from "./cmux.ts";
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

type MessageRows = { index: number; lines: string[] };

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
      if ((this.options.tui as any).getFocusedComponent?.() === this) {
        this.options.tui.setFocus(this.restoreFocus);
      }
      this.restoreFocus = null;
    }
    this.refresh();
  }

  updateMessages(messages: UserMessage[]): void {
    const previousId = this.selectedId;
    this.messages = messages;
    const ids = new Set(messages.map((message) => message.id));
    for (const id of this.expandedIds) if (!ids.has(id)) this.expandedIds.delete(id);

    if (this.followTail || !previousId || !ids.has(previousId)) {
      this.selectedId = messages.at(-1)?.id ?? null;
      this.followTail = true;
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
    this.refresh();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.min(SIDEBAR_WIDTH, width));
    const targetHeight = Math.max(1, this.options.tui.terminal.rows);
    const signature = this.signature(safeWidth, targetHeight);
    if (signature === this.cachedSignature) return this.cachedLines;

    const renderedHeader = this.renderHeader(safeWidth);
    const header = renderedHeader.slice(0, Math.min(renderedHeader.length, targetHeight));
    const maxDockRows = Math.max(0, targetHeight - header.length);
    const dock = renderStatusDock(
      safeWidth,
      this.options.ctx,
      this.options.getFooterData(),
      this.options.getThinkingLevel(),
      this.focused,
      this.options.getCmuxContext,
      maxDockRows,
    );
    const bodyHeight = Math.max(0, targetHeight - header.length - dock.length);
    const result = [...header, ...this.renderBody(safeWidth, bodyHeight), ...dock];
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

  private renderHeader(width: number): string[] {
    const focus = this.focused ? `${FG_ACC}focused${RST}` : `${FG_DIM}passive${RST}`;
    const tail = this.followTail ? `${FG_DIM}tail${RST}` : `${FG_MID}browsing${RST}`;
    return [
      fillRow(` ${BOLD}${FG_BRIGHT}Messages${RST} ${FG_FAINT}${this.messages.length}${RST}`, width, BG_HDR),
      fillRow(` ${focus}${FG_FAINT} · ${RST}${tail}`, width, BG),
    ];
  }

  private renderBody(width: number, height: number): string[] {
    if (height === 0) return [];
    if (this.messages.length === 0) {
      return this.padTop([fillRow(` ${FG_DIM}No messages yet${RST}`, width, BG)], height, width);
    }

    const selected = this.selectedIndex();
    const newest = this.messages.length - 1;
    const selectedBudget = Math.max(1, height - (selected === newest ? 0 : height >= 3 ? 2 : 1));
    const groups = new Map<number, MessageRows>();
    groups.set(selected, { index: selected, lines: this.renderMessage(selected, width, selectedBudget) });
    if (selected !== newest && height >= 2) {
      groups.set(newest, { index: newest, lines: this.renderMessage(newest, width, 1) });
    }

    const candidates = Array.from({ length: this.messages.length }, (_, index) => index)
      .filter((index) => !groups.has(index))
      .sort((a, b) => {
        const aDistance = Math.min(Math.abs(a - selected), newest - a);
        const bDistance = Math.min(Math.abs(b - selected), newest - b);
        return aDistance - bDistance || b - a;
      });
    for (const index of candidates) {
      const group = { index, lines: this.renderMessage(index, width) };
      groups.set(index, group);
      if (this.composeGroups(groups, width, true).length > height) groups.delete(index);
    }

    let lines = this.composeGroups(groups, width, true);
    if (lines.length > height) lines = this.composeGroups(groups, width, false);
    return this.padTop(lines, height, width);
  }

  private composeGroups(groups: Map<number, MessageRows>, width: number, showGaps: boolean): string[] {
    const ordered = [...groups.values()].sort((a, b) => a.index - b.index);
    const lines: string[] = [];
    let previous = -1;
    for (const group of ordered) {
      if (showGaps && previous >= 0 && group.index > previous + 1) {
        lines.push(fillRow(` ${FG_FAINT}··· ${group.index - previous - 1} hidden${RST}`, width, BG));
      }
      lines.push(...group.lines);
      previous = group.index;
    }
    return lines;
  }

  private padTop(lines: string[], height: number, width: number): string[] {
    const padding = Array.from({ length: Math.max(0, height - lines.length) }, () => fillRow(" ", width, BG));
    return [...padding, ...lines];
  }

  private renderMessage(index: number, width: number, maxRows = 10): string[] {
    const message = this.messages[index]!;
    const selected = message.id === this.selectedId;
    const background = selected ? BG_SEL : BG;
    const arrow = selected && this.focused ? `${FG_ACC}›${RST}` : " ";
    const number = `${FG_FAINT}${String(message.index).padStart(2)}${RST}`;
    const time = `${FG_TIME}${formatTime(message.timestamp)}${RST}`;
    if (!this.expandedIds.has(message.id) || maxRows <= 1) {
      const prefix = ` ${arrow}${number} ${time} `;
      const text = truncateToWidth(message.text.replace(/\s+/g, " "), Math.max(0, width - visibleWidth(prefix)), "…");
      return [fillRow(`${prefix}${selected ? FG_BRIGHT : FG_NORM}${text}${RST}`, width, background)];
    }

    const lines = [fillRow(` ${arrow}${number} ${time}`, width, background)];
    const wrapped = wrapText(message.text, Math.max(1, width - 4));
    const contentRows = Math.max(0, maxRows - 2);
    for (const line of wrapped.slice(0, contentRows)) {
      lines.push(fillRow(`   ${FG_EXP}${line}${RST}`, width, background));
    }
    if (wrapped.length > contentRows && lines.length < maxRows) {
      lines.push(fillRow(`   ${FG_DIM}${DIM}…+${wrapped.length - contentRows} lines${RST}`, width, background));
    } else if (lines.length < maxRows) {
      lines.push(fillRow(" ", width, background));
    }
    return lines;
  }

  private selectedIndex(): number {
    if (this.messages.length === 0) return -1;
    const index = this.messages.findIndex((message) => message.id === this.selectedId);
    return index >= 0 ? index : this.messages.length - 1;
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
      statuses: statuses ? [...statuses.entries()] : [],
      goal: goal ? `${goal.goalId}:${goal.status}:${goal.tokensUsed}:${goal.activeSeconds}:${goal.updatedAt}` : null,
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
