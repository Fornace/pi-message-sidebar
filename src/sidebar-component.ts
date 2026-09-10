import {
  copyToClipboard,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import type { CmuxContext } from "./cmux.ts";
import { SIDEBAR_WIDTH } from "./constants.ts";
import { readSessionGoal } from "./goal.ts";
import { assertLinesFit } from "./layout.ts";
import { MessagePanel } from "./messages.ts";
import { renderGoalSection, renderRuntimeSection, renderSessionSection, ruleRow } from "./sections.ts";
import { BG, FG_BRIGHT, FG_DIM, FG_FAINT, BOLD, RST, fillRow } from "./style.ts";

import type { UserMessage } from "./types.ts";

export type { UserMessage };

type SidebarOptions = {
  tui: TUI;
  ctx: ExtensionContext;
  getFooterData: () => ReadonlyFooterDataProvider | null;
  getThinkingLevel: () => string;
  getCmuxContext: () => CmuxContext | null;
  getSummary: (messageId: string, text: string) => string;
  hasSummary: (messageId: string) => boolean;
  summariesConfigured: () => boolean;
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
  /** heading + one two-row message + hint. */
  messages: 4,
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

export class SidebarComponent implements Component {
  private focused = false;
  private panel: MessagePanel;
  private version = 0;
  private restoreFocus: Component | null = null;
  private cachedSignature = "";
  private cachedLines: string[] = [];

  constructor(private readonly options: SidebarOptions) {
    this.panel = new MessagePanel(
      {
        getSummary: options.getSummary,
        hasSummary: options.hasSummary,
        summariesConfigured: options.summariesConfigured,
        requestRefresh: () => this.refresh(),
      },
      options.messages,
    );
  }

  isFocused(): boolean { return this.focused; }
  getSelectedMessageId(): string | null { return this.panel.getSelectedMessageId(); }
  isFollowingTail(): boolean { return this.panel.isFollowingTail(); }
  isExpanded(messageId: string): boolean { return this.panel.isExpanded(messageId); }
  isDetailOpen(): boolean { return this.panel.isDetailOpen(); }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    if (focused) {
      this.restoreFocus = (this.options.tui as any).getFocusedComponent?.() ?? null;
      this.focused = true;
      this.options.tui.setFocus(this);
    } else {
      this.focused = false;
      this.panel.closeDetail();
      if ((this.options.tui as any).getFocusedComponent?.() === this) this.options.tui.setFocus(this.restoreFocus);
      this.restoreFocus = null;
    }
    this.refresh();
  }

  updateMessages(messages: UserMessage[]): void {
    this.panel.updateMessages(messages);
  }

  refresh(): void {
    this.version++;
    this.options.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      if (this.panel.isDetailOpen()) { this.panel.closeDetail(); return; }
      return this.setFocused(false);
    }
    if (!this.panel.isDetailOpen() && matchesKey(data, "c")) { void this.copySessionPath(); return; }
    this.panel.handleInput(data);
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
    lines.push(...this.panel.renderSection(layout.messages, this.focused));
    lines.push(ruleRow());
    lines.push(...renderRuntimeSection(ctx, this.options.getFooterData(), this.options.getThinkingLevel(), layout.runtime));
    return lines;
  }

  /** Bounded to the width actually offered, so a narrow slot never overflows its column. */
  private renderNotice(width: number, height: number, hasGoal: boolean): string[] {
    const row = (text: string) =>
      width <= 1 ? fillRow("", width, BG) : `${FG_FAINT}│${RST}${fillRow(` ${text}`, width - 1, BG)}`;
    const lines: string[] = [];
    const push = (text: string) => { if (lines.length < height) lines.push(row(text)); };
    push(`${BOLD}${FG_BRIGHT}Sidebar${RST}`);
    push(`${FG_DIM}needs ${SIDEBAR_WIDTH}×${minimumHeight(hasGoal)}${RST}`);
    while (lines.length < height) lines.push(row(""));
    return lines;
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
