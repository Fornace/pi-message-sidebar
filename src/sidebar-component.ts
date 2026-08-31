import {
  copyToClipboard,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { GAP_WINDOW, PINNED_COUNT, SIDEBAR_WIDTH } from "./constants.ts";
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
  messages: UserMessage[];
};

export class SidebarComponent {
  private focused = false;
  private selected = 0;
  private expanded = new Set<number>();
  private messages: UserMessage[];
  private version = 0;
  private restoreFocus: Component | null = null;
  private cachedSignature = "";
  private cachedLines: string[] = [];

  constructor(private readonly options: SidebarOptions) {
    this.messages = options.messages;
    this.selected = Math.max(0, this.messages.length - 1);
  }

  isFocused(): boolean { return this.focused; }

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
    this.messages = messages;
    this.selected = Math.min(this.selected, Math.max(0, messages.length - 1));
    this.refresh();
  }

  refresh(): void {
    this.version++;
    this.options.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) return this.setFocused(false);
    if (matchesKey(data, "c")) { void this.copySessionPath(); return; }
    if (matchesKey(data, "up")) this.selected = Math.max(0, this.selected - 1);
    else if (matchesKey(data, "down")) this.selected = Math.min(this.messages.length - 1, this.selected + 1);
    else if (matchesKey(data, "pageUp")) this.selected = Math.max(0, this.selected - 10);
    else if (matchesKey(data, "pageDown")) this.selected = Math.min(this.messages.length - 1, this.selected + 10);
    else if (matchesKey(data, "home")) this.selected = 0;
    else if (matchesKey(data, "end")) this.selected = Math.max(0, this.messages.length - 1);
    else if (matchesKey(data, "return") || matchesKey(data, "enter") || data === " ") {
      if (this.expanded.has(this.selected)) this.expanded.delete(this.selected);
      else this.expanded.add(this.selected);
    } else return;
    this.refresh();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.min(SIDEBAR_WIDTH, width));
    const targetHeight = Math.max(15, this.options.tui.terminal.rows);
    const signature = this.signature(safeWidth, targetHeight);
    if (signature === this.cachedSignature) return this.cachedLines;

    const lines = this.renderHeader(safeWidth);
    if (this.messages.length === 0) {
      lines.push(fillRow(" No messages yet", safeWidth, BG));
    } else {
      lines.push(...this.renderMessages(safeWidth));
    }

    const dock = renderStatusDock(
      safeWidth,
      this.options.ctx,
      this.options.getFooterData(),
      this.options.getThinkingLevel(),
      this.focused,
    );
    while (lines.length < targetHeight - dock.length) lines.push(fillRow(" ", safeWidth, BG));
    const bodyLimit = Math.max(0, targetHeight - dock.length);
    const result = [...lines.slice(0, bodyLimit), ...dock].slice(0, targetHeight);
    assertLinesFit(result, safeWidth, "sidebar");
    this.cachedSignature = signature;
    this.cachedLines = result;
    return result;
  }

  invalidate(): void {
    this.cachedSignature = "";
    this.cachedLines = [];
  }

  private renderHeader(width: number): string[] {
    const icon = this.focused ? `${FG_ACC}●${RST}` : `${FG_DIM}○${RST}`;
    const mode = this.focused ? `${FG_ACC}●${RST} ${FG_MID}focused${RST}` : `${FG_DIM}passive${RST}`;
    const separator = `${FG_DIM}${"─".repeat(Math.max(0, width - 4))}${RST}`;
    return [
      fillRow(" ", width, BG_HDR),
      fillRow(` ${icon} ${BOLD}${FG_BRIGHT}Messages${RST}${FG_DIM} ${this.messages.length}${RST}  ${mode}`, width, BG_HDR),
      fillRow(" ", width, BG_HDR),
      fillRow(` ${separator}`, width, BG),
    ];
  }

  private renderMessages(width: number): string[] {
    const result: string[] = [];
    let previous = -1;
    for (const index of this.visibleIndices()) {
      if (index > previous + 1 && previous >= 0) {
        result.push(fillRow(`     ${FG_DIM}··· ${index - previous - 1} more ···${RST}`, width, BG));
      }
      result.push(...this.renderMessage(index, width));
      previous = index;
    }
    return result;
  }

  private renderMessage(index: number, width: number): string[] {
    const message = this.messages[index]!;
    const selected = index === this.selected;
    const background = selected ? BG_SEL : BG;
    const arrow = selected && this.focused ? `${FG_ACC}▸${RST}` : " ";
    const number = `${FG_FAINT}${String(message.index).padStart(2)}${RST}`;
    const time = `${FG_TIME}${formatTime(message.timestamp)}${RST}`;
    if (!this.expanded.has(index)) {
      const prefix = ` ${arrow}${number} ${time} `;
      const text = truncateToWidth(message.text.replace(/\s+/g, " "), Math.max(0, width - visibleWidth(prefix)), "…");
      return [fillRow(`${prefix}${selected ? FG_BRIGHT : FG_NORM}${text}${RST}`, width, background)];
    }

    const lines = [fillRow(` ${arrow}${number} ${time}`, width, background)];
    const wrapped = wrapText(message.text, Math.max(1, width - 4));
    for (const line of wrapped.slice(0, 8)) lines.push(fillRow(`   ${FG_EXP}${line}${RST}`, width, background));
    if (wrapped.length > 8) {
      lines.push(fillRow(`   ${FG_DIM}${DIM}…+${wrapped.length - 8} lines${RST}`, width, background));
    }
    lines.push(fillRow(" ", width, background));
    return lines;
  }

  private visibleIndices(): number[] {
    const total = this.messages.length;
    if (total <= PINNED_COUNT * 2 + 1) return Array.from({ length: total }, (_, index) => index);
    const indices = new Set<number>();
    for (let i = 0; i < PINNED_COUNT; i++) indices.add(i);
    for (let i = total - PINNED_COUNT; i < total; i++) indices.add(i);
    if (this.selected >= PINNED_COUNT && this.selected < total - PINNED_COUNT) {
      const start = Math.max(PINNED_COUNT, Math.min(this.selected - 1, total - PINNED_COUNT - GAP_WINDOW));
      for (let i = start; i < start + GAP_WINDOW; i++) indices.add(i);
    }
    return [...indices].sort((a, b) => a - b);
  }

  private signature(width: number, height: number): string {
    const usage = this.options.ctx.getContextUsage?.();
    const statuses = this.options.getFooterData()?.getExtensionStatuses();
    return JSON.stringify({
      width,
      height,
      version: this.version,
      messages: this.messages.length,
      model: this.options.ctx.model?.id,
      thinking: this.options.getThinkingLevel(),
      usage,
      statuses: statuses ? [...statuses.entries()] : [],
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
