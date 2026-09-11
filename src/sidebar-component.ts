import {
  copyToClipboard,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import { ANIM_TICK_MS, EasedMeter, isVictory } from "./anim.ts";
import type { CmuxContext } from "./cmux.ts";
import { SIDEBAR_WIDTH } from "./constants.ts";
import type { FileEdit } from "./files.ts";
import { flagRow } from "./flag.ts";
import { readSessionGoal } from "./goal.ts";
import { assertLinesFit } from "./layout.ts";
import { MessagePanel } from "./messages.ts";
import { resolvePalette } from "./palette.ts";
import { renderGoalSection } from "./goal-card.ts";
import { renderRuntimeSection, renderSessionSection } from "./sections.ts";
import { computeUsage } from "./status-dock.ts";
import { RST, fillRow } from "./style.ts";

import type { UserMessage } from "./types.ts";

export type { UserMessage };

type SidebarOptions = {
  tui: TUI;
  ctx: ExtensionContext;
  getFooterData: () => ReadonlyFooterDataProvider | null;
  getThinkingLevel: () => string;
  getCmuxContext: () => CmuxContext | null;
  getTheme: () => Theme | null;
  getSummary: (messageId: string, text: string) => string;
  hasSummary: (messageId: string) => boolean;
  isPending: (messageId: string) => boolean;
  summariesConfigured: () => boolean;
  getEditedFiles: () => FileEdit[];
  getGitStatus: (path: string) => string | null;
  messages: UserMessage[];
};

type Layout = { goal: number; session: number; runtime: number; messages: number };

/** Rows a section cannot render without losing content it is required to show.
 *  Section headers embed their own rules, so no separator rows are budgeted. */
const MANDATORY = {
  /** the flag crown row. */
  crown: 1,
  /** status chip + two title rows + budget meter; the no-goal state is one ghost row. */
  goal: (hasGoal: boolean) => (hasGoal ? 4 : 1),
  /** separator + ghost header + surface/workspace + cwd. */
  session: 4,
  /** air + ghost header + one two-row message + hint strip. */
  messages: 5,
  /** separator + ghost header + model route + ctx meter. */
  runtime: 4,
} as const;

/** Smallest terminal that can hold every mandatory row; below it the rail shows a notice. */
export function minimumHeight(hasGoal: boolean): number {
  return MANDATORY.crown + MANDATORY.goal(hasGoal) + MANDATORY.session + MANDATORY.messages + MANDATORY.runtime;
}

/**
 * Mandatory rows first, then optional rows in priority order, then every
 * remaining row to the message viewport. Returns null when the mandatory
 * budget does not fit, so the caller renders a notice instead of silently
 * slicing content away.
 */
function allocate(height: number, hasGoal: boolean, fileCount: number): Layout | null {
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
  if (hasGoal) grow(4, (granted) => { goal += granted; }); // card air, third title line, meter pad: 8 rows total
  grow(1, (granted) => { session += granted; });          // session id row
  if (fileCount > 0) {
    // FILES lives inside the session block: air, header, plus file rows. It
    // needs the air, the header and one row to be worth anything, so a
    // cramped rail leaves it out entirely.
    const granted = Math.min(2 + fileCount, spare);
    if (granted >= 3) { session += granted; spare -= granted; }
  }
  grow(1, (granted) => { runtime += granted; });          // trailing breath under the meter

  return { goal, session, runtime, messages: MANDATORY.messages + spare };
}

export class SidebarComponent implements Component {
  private focused = false;
  private panel: MessagePanel;
  private version = 0;
  private restoreFocus: Component | null = null;
  private cachedSignature = "";
  private cachedLines: string[] = [];
  private animTimer: ReturnType<typeof setInterval> | null = null;
  private readonly goalMeter = new EasedMeter();
  private readonly ctxMeter = new EasedMeter();
  private goalTarget: number | null = null;
  private ctxTarget: number | null = null;
  private previousGoalStatus: string | null = null;
  private victoryAt: number | null = null;

  constructor(private readonly options: SidebarOptions) {
    this.panel = new MessagePanel(
      {
        getSummary: options.getSummary,
        hasSummary: options.hasSummary,
        isPending: options.isPending,
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
    this.ensureAnim();
  }

  /** Stops the animation tick; the extension calls this on session shutdown. */
  stopAnimations(): void {
    if (this.animTimer) clearInterval(this.animTimer);
    this.animTimer = null;
  }

  /** The tick exists only while a dot pulses or a summary settles. */
  /** The rail is alive while a dot pulses, a glow decays, a meter eases, or
   *  an active goal breathes: the ambient breath is the session's heartbeat,
   *  and it stops the moment the goal completes or clears. */
  private needsAnim(now: number): boolean {
    if (this.panel.needsAnim(now)) return true;
    if (this.goalMeter.moving(this.goalTarget) || this.ctxMeter.moving(this.ctxTarget)) return true;
    if (this.victoryAt !== null && isVictory(now, this.victoryAt)) return true;
    return readSessionGoal(this.options.ctx)?.status === "active";
  }

  private ensureAnim(): void {
    const live = this.needsAnim(Date.now());
    if (live && !this.animTimer) {
      this.animTimer = setInterval(() => {
        if (!this.panel.needsAnim(Date.now())) {
          this.stopAnimations();
          this.refresh();
          return;
        }
        this.version++;
        this.options.tui.requestRender();
      }, ANIM_TICK_MS);
      (this.animTimer as { unref?: () => void }).unref?.();
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      if (this.panel.isDetailOpen()) { this.panel.closeDetail(); return; }
      return this.setFocused(false);
    }
    if (!this.panel.isDetailOpen() && matchesKey(data, "c")) {
      void this.copyRailTarget();
      return;
    }
    this.panel.handleInput(data);
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.min(SIDEBAR_WIDTH, width));
    const targetHeight = Math.max(1, this.options.tui.terminal.rows);
    const signature = this.signature(safeWidth, targetHeight);
    if (signature === this.cachedSignature) return this.cachedLines;

    const hasGoal = readSessionGoal(this.options.ctx) !== null;
    const files = this.options.getEditedFiles();
    const layout = safeWidth < SIDEBAR_WIDTH ? null : allocate(targetHeight, hasGoal, files.length);
    const result = layout
      ? this.renderRail(safeWidth, targetHeight, layout, files)
      : this.renderNotice(safeWidth, targetHeight, hasGoal);
    assertLinesFit(result, safeWidth, "sidebar");
    if (result.length !== targetHeight) {
      throw new Error(`sidebar height mismatch (${result.length} != ${targetHeight})`);
    }
    this.cachedSignature = signature;
    this.cachedLines = result;
    this.ensureAnim();
    return result;
  }

  invalidate(): void {
    this.cachedSignature = "";
    this.cachedLines = [];
  }

  // --- rail ---------------------------------------------------------------

  private renderRail(_width: number, height: number, layout: Layout, files: FileEdit[]): string[] {
    const ctx = this.options.ctx;
    const palette = resolvePalette(this.options.getTheme());
    const now = Date.now();
    const lines: string[] = [];
    const goal = readSessionGoal(ctx);
    if (goal?.status === "complete" && this.previousGoalStatus !== "complete") this.victoryAt = now;
    this.previousGoalStatus = goal?.status ?? null;
    const live = this.needsAnim(now);
    lines.push(flagRow(palette, SIDEBAR_WIDTH - 1, now, live));
    this.goalTarget = goal?.tokenBudget ? Math.min(1, goal.usage.tokensUsed / goal.tokenBudget) : null;
    this.goalMeter.tick(this.goalTarget);
    const usage = computeUsage(ctx);
    this.ctxTarget = usage.contextPercent === null ? null : Math.min(1, usage.contextPercent / 100);
    this.ctxMeter.tick(this.ctxTarget);
    const goalShimmer = this.goalMeter.moving(this.goalTarget) ? Math.floor(now / 120) % 12 : null;
    const ctxShimmer = this.ctxMeter.moving(this.ctxTarget) ? Math.floor(now / 120) % 10 : null;

    lines.push(...renderGoalSection(goal, layout.goal, palette, now, this.goalMeter, undefined, goalShimmer, this.victoryAt));
    lines.push(...renderSessionSection(
      ctx, this.options.getFooterData(), this.options.getCmuxContext(),
      layout.session, palette, files, this.options.getGitStatus,
    ));
    lines.push(...this.panel.renderSection(layout.messages, this.focused, palette, now));
    lines.push(...renderRuntimeSection(
      ctx, this.options.getFooterData(), this.options.getThinkingLevel(),
      layout.runtime, palette, undefined, this.ctxMeter.get(), ctxShimmer,
    ));
    return lines;
  }

  /** Bounded to the width actually offered, so a narrow slot never overflows its column. */
  private renderNotice(width: number, height: number, hasGoal: boolean): string[] {
    const palette = resolvePalette(this.options.getTheme());
    const row = (text: string) =>
      width <= 1
        ? fillRow("", width, palette.bgDeep)
        : `${palette.edge}│${RST}${fillRow(` ${text}`, width - 1, palette.bgDeep)}`;
    const lines: string[] = [];
    const push = (text: string) => { if (lines.length < height) lines.push(row(text)); };
    push(`${palette.bold(`${palette.textNew}Sidebar${RST}`)}`);
    push(`${palette.ghost}needs ${SIDEBAR_WIDTH}×${minimumHeight(hasGoal)}${RST}`);
    while (lines.length < height) lines.push(row(""));
    return lines;
  }

  private signature(width: number, height: number): string {
    const usage = this.options.ctx.getContextUsage?.();
    const statuses = this.options.getFooterData()?.getExtensionStatuses();
    const goal = readSessionGoal(this.options.ctx);
    const cmux = this.options.getCmuxContext();
    const files = this.options.getEditedFiles();
    const theme = this.options.getTheme();
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
      files: `${files.length}:${files[0]?.path ?? ""}`,
      theme: theme?.name ?? null,
      goalMeter: this.goalMeter.get()?.toFixed(3) ?? null,
      ctxMeter: this.ctxMeter.get()?.toFixed(3) ?? null,
    });
  }

  /** Focused with a selection copies that prompt; the unfocused rail copies the session identity. */
  private async copyRailTarget(): Promise<void> {
    const message = this.focused ? this.panel.selectedMessageText() : null;
    if (message !== null) {
      try {
        await copyToClipboard(message);
        this.options.ctx.ui.notify("Copied prompt", "info");
      } catch {
        this.options.ctx.ui.notify("Copy failed", "warning");
      }
      return;
    }
    await this.copySessionPath();
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
