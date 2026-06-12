/**
 * Message Sidebar — full-height, modern, borderless overlay
 *
 * Always visible in passive mode. Ctrl+Shift+H focuses for navigation.
 *
 * Design: borderless layered surfaces, stable spatial zones,
 * semantic accents, and consistent fill via BG-injection after every ANSI reset.
 *
 * Focused mode (Ctrl+Shift+H):
 *   - ↑/↓          navigate all messages
 *   - Enter/Space   toggle expand/collapse
 *   - PageUp/Dn     jump 10 messages
 *   - Home/End      first/last message
 *   - Escape        return to passive mode
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { basename } from "node:path";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── Config ──────────────────────────────────────────────────────────────────
const SIDEBAR_WIDTH = 42;
const SIDEBAR_GAP = 1;
const RESERVED_WIDTH = SIDEBAR_WIDTH + SIDEBAR_GAP;
const MIN_MAIN_WIDTH = 80;
const PINNED_COUNT = 5;
const GAP_WINDOW = 3;

// ── Palette ─────────────────────────────────────────────────────────────────
const BG       = "\x1b[48;5;232m";  // panel background, very dark
const BG_SEL   = "\x1b[48;5;235m";  // selected row
const BG_HDR   = "\x1b[48;5;233m";  // header surface
const BG_CARD  = "\x1b[48;5;234m";  // subtle info dock surface

const FG_FAINT = "\x1b[38;5;240m";
const FG_DIM   = "\x1b[38;5;243m";
const FG_MID   = "\x1b[38;5;248m";
const FG_NORM  = "\x1b[38;5;250m";
const FG_BRIGHT= "\x1b[38;5;255m";
const FG_ACC   = "\x1b[38;5;75m";   // blue accent
const FG_INFO  = "\x1b[38;5;80m";   // cyan/info
const FG_OK    = "\x1b[38;5;114m";  // green/safe
const FG_WARN  = "\x1b[38;5;215m";  // amber/warning
const FG_ERR   = "\x1b[38;5;203m";  // red/error
const FG_TIME  = "\x1b[38;5;242m";
const FG_EXP   = "\x1b[38;5;252m";  // expanded text
const FG_DOT   = FG_OK;              // focused indicator

const BOLD     = "\x1b[1m";
const DIM      = "\x1b[2m";
const RST      = "\x1b[0m";


// ── Core rendering fix: inject BG after every RST ──────────────────────────
/**
 * The #1 bug in terminal TUI: when content contains \x1b[0m (reset),
 * it strips the background color, leaving black gaps.
 * Fix: replace every RST in the content with RST+BG so the background
 * continues seamlessly across color changes.
 */
function fillRow(content: string, width: number, bg: string): string {
  // Inject bg after every reset in the content
  const injected = content.replace(/\x1b\[0m/g, `\x1b[0m${bg}`);
  const vis = visibleWidth(injected);
  const pad = Math.max(0, width - vis);
  return `${bg}${injected}${" ".repeat(pad)}\x1b[0m`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractUserText(msg: AgentMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
  }
  return "";
}

interface UserMsg {
  id: string;
  text: string;
  index: number;
  timestamp: string;
}

type FooterData = {
  getGitBranch(): string | null;
  getExtensionStatuses(): ReadonlyMap<string, string>;
  getAvailableProviderCount(): number;
  onBranchChange(callback: () => void): () => void;
};

function collectUserMessages(ctx: ExtensionContext): UserMsg[] {
  const entries = ctx.sessionManager.getBranch();
  const msgs: UserMsg[] = [];
  let idx = 0;
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "user") {
      idx++;
      const text = extractUserText(entry.message);
      if (text.trim()) {
        msgs.push({ id: entry.id, text: text.trim(), index: idx, timestamp: entry.timestamp });
      }
    }
  }
  return msgs;
}

function fmtTime(ts: string): string {
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch { return ""; }
}

function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function formatTokens(count: number): string {
  if (!count) return "0";
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function contextColor(percent: number | null): string {
  if (percent === null) return FG_DIM;
  if (percent > 90) return FG_ERR;
  if (percent > 70) return FG_WARN;
  return FG_OK;
}

function progressBar(percent: number | null, width = 10): string {
  if (percent === null) return `${FG_DIM}${"░".repeat(width)}${RST}`;
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const color = contextColor(percent);
  return `${color}${"█".repeat(filled)}${FG_DIM}${"░".repeat(width - filled)}${RST}`;
}

function formatCwd(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && cwd === home) return "~";
  if (home && cwd.startsWith(`${home}/`)) return `~/${cwd.slice(home.length + 1)}`;
  return basename(cwd) || cwd;
}

function wrapText(text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (visibleWidth(test) > maxW && cur) { lines.push(cur); cur = w; }
    else { cur = test; }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

// ── Layout reservation shim ─────────────────────────────────────────────────

const LAYOUT_PATCH_KEY = Symbol.for("pi-message-sidebar.layoutPatch");

interface LayoutPatchState {
  originalRender: (width: number) => string[];
  refs: number;
  reserveCols: number;
}

function getReservedColumns(width: number, reserveCols: number): number {
  // On narrow terminals, don't reserve space; let pi keep a usable main area.
  return width >= MIN_MAIN_WIDTH + reserveCols ? reserveCols : 0;
}

function installLayoutPatch(tui: any, reserveCols: number): () => void {
  const existing = tui[LAYOUT_PATCH_KEY] as LayoutPatchState | undefined;
  if (existing) {
    existing.refs++;
    existing.reserveCols = reserveCols;
    tui.requestRender?.(true);
    return () => {
      existing.refs--;
      if (existing.refs <= 0) {
        tui.render = existing.originalRender;
        delete tui[LAYOUT_PATCH_KEY];
        tui.requestRender?.(true);
      }
    };
  }

  const state: LayoutPatchState = {
    originalRender: tui.render.bind(tui),
    refs: 1,
    reserveCols,
  };

  tui[LAYOUT_PATCH_KEY] = state;
  tui.render = (width: number): string[] => {
    const reserved = getReservedColumns(width, state.reserveCols);
    const baseWidth = Math.max(1, width - reserved);
    return state.originalRender(baseWidth);
  };

  tui.requestRender?.(true);

  return () => {
    state.refs--;
    if (state.refs <= 0) {
      tui.render = state.originalRender;
      delete tui[LAYOUT_PATCH_KEY];
      tui.requestRender?.(true);
    }
  };
}

class LayoutReserveComponent {
  private uninstall: () => void;

  constructor(tui: any) {
    this.uninstall = installLayoutPatch(tui, RESERVED_WIDTH);
  }

  render(): string[] { return []; }
  invalidate() {}
  dispose() { this.uninstall(); }
}

class FooterBridgeComponent {
  private unsubscribe: () => void;
  private onChange: () => void;
  private onDispose: () => void;

  constructor(footerData: FooterData, onChange: () => void, onDispose: () => void) {
    this.onChange = onChange;
    this.unsubscribe = footerData.onBranchChange(onChange);
    this.onDispose = onDispose;
  }

  // Empty footer: the sidebar renders all footer/status information instead.
  render(): string[] { return []; }
  invalidate() { this.onChange(); }
  dispose() { this.unsubscribe(); this.onDispose(); }
}

// ── Sidebar Component ───────────────────────────────────────────────────────

class SidebarComponent {
  private focused = false;
  private selected = 0;
  private expanded = new Set<number>();
  private msgs: UserMsg[] = [];
  private done: (result: undefined) => void;
  private tui: any;
  private ctx: ExtensionContext;
  private getFooterData: () => FooterData | null;
  private getThinkingLevel: () => string;

  private cachedW = -1;
  private cachedH = -1;
  private cachedSig = "";
  private cachedLines: string[] = [];
  private ver = 0;
  private lastVer = -1;

  constructor(
    tui: any,
    ctx: ExtensionContext,
    getFooterData: () => FooterData | null,
    getThinkingLevel: () => string,
    msgs: UserMsg[],
    done: (result: undefined) => void,
  ) {
    this.tui = tui;
    this.ctx = ctx;
    this.getFooterData = getFooterData;
    this.getThinkingLevel = getThinkingLevel;
    this.msgs = msgs;
    this.done = done;
    this.selected = msgs.length > 0 ? msgs.length - 1 : 0;
  }

  setFocused(f: boolean) { if (this.focused !== f) { this.focused = f; this.ver++; this.tui.requestRender(); } }
  isFocused() { return this.focused; }

  updateMessages(msgs: UserMsg[]) {
    this.msgs = msgs;
    if (this.selected >= msgs.length) this.selected = Math.max(0, msgs.length - 1);
    this.ver++;
    this.tui.requestRender();
  }

  handleInput(data: string) {
    if (matchesKey(data, "escape")) { this.setFocused(false); return; }
    if (matchesKey(data, "up") && this.selected > 0) { this.selected--; this.ver++; this.tui.requestRender(); return; }
    if (matchesKey(data, "down") && this.selected < this.msgs.length - 1) { this.selected++; this.ver++; this.tui.requestRender(); return; }
    if (matchesKey(data, "pageUp")) { this.selected = Math.max(0, this.selected - 10); this.ver++; this.tui.requestRender(); return; }
    if (matchesKey(data, "pageDown")) { this.selected = Math.min(this.msgs.length - 1, this.selected + 10); this.ver++; this.tui.requestRender(); return; }
    if (matchesKey(data, "home")) { this.selected = 0; this.ver++; this.tui.requestRender(); return; }
    if (matchesKey(data, "end")) { this.selected = this.msgs.length - 1; this.ver++; this.tui.requestRender(); return; }
    if (matchesKey(data, "return") || matchesKey(data, "enter") || data === " ") {
      if (this.expanded.has(this.selected)) this.expanded.delete(this.selected);
      else this.expanded.add(this.selected);
      this.ver++; this.tui.requestRender();
    }
  }

  refresh() { this.ver++; this.tui.requestRender(); }

  private footerSignature(): string {
    const footerData = this.getFooterData();
    const usage = this.computeUsage();
    const statuses = footerData ? [...footerData.getExtensionStatuses().entries()] : [];
    return JSON.stringify({
      usage,
      cwd: this.ctx.sessionManager.getCwd(),
      sessionName: this.ctx.sessionManager.getSessionName?.(),
      branch: footerData?.getGitBranch() ?? null,
      providerCount: footerData?.getAvailableProviderCount() ?? 0,
      statuses,
      model: this.ctx.model ? `${this.ctx.model.provider}/${this.ctx.model.id}` : "none",
      thinking: this.getThinkingLevel(),
    });
  }

  render(width: number): string[] {
    const termH = this.tui.terminal?.rows ?? 40;
    const targetH = Math.max(15, termH);
    const sig = this.footerSignature();

    if (width === this.cachedW && targetH === this.cachedH && this.cachedSig === sig && this.lastVer === this.ver) {
      return this.cachedLines;
    }

    const w = Math.min(SIDEBAR_WIDTH, width);
    const lines: string[] = [];

    // Borderless internal padding. Keep inset tight; content is the structure.
    const pad = " ";
    const barPad = pad;
    const barSpace = pad;

    // ── Header ──
    lines.push(fillRow(`${barPad}`, w, BG_HDR)); // blank line above
    const hdrIcon = this.focused ? `${FG_ACC}●${RST}` : `${FG_DIM}○${RST}`;
    const hdrTitle = `${BOLD}${FG_BRIGHT}Messages${RST}`;
    const hdrCount = `${FG_DIM} ${this.msgs.length}${RST}`;
    const hdrMode = this.focused
      ? `  ${FG_DOT}●${RST} ${FG_MID}focused${RST}`
      : `  ${FG_DIM}passive${RST}`;
    lines.push(fillRow(`${barPad}${hdrIcon} ${hdrTitle}${hdrCount}${hdrMode}`, w, BG_HDR));
    lines.push(fillRow(`${barPad}`, w, BG_HDR)); // blank line below

    // Subtle separator
    const sep = `${FG_DIM}${"─".repeat(Math.max(0, w - visibleWidth(barSpace) - 3))}${RST}`;
    lines.push(fillRow(`${barSpace}${sep}`, w, BG));

    // ── Empty state ──
    if (this.msgs.length === 0) {
      lines.push(fillRow(`${barPad}`, w, BG)); // blank
      lines.push(fillRow(`${barPad}${FG_DIM}No messages yet${RST}`, w, BG));
      lines.push(fillRow(`${barPad}`, w, BG)); // blank
      const bottomRows = this.renderStatusCards(w, barPad, barSpace);
      while (lines.length < targetH - bottomRows.length) lines.push(fillRow(`${barSpace}`, w, BG));
      lines.push(...bottomRows);
      this.cachedLines = lines; this.cachedW = width; this.cachedH = targetH; this.cachedSig = sig; this.lastVer = this.ver;
      return lines;
    }

    // ── Visible indices ──
    const total = this.msgs.length;
    const showAll = total <= PINNED_COUNT * 2 + 1;
    const visibleIndices: number[] = [];

    if (showAll) {
      for (let i = 0; i < total; i++) visibleIndices.push(i);
    } else {
      const set = new Set<number>();
      for (let i = 0; i < PINNED_COUNT; i++) set.add(i);
      for (let i = total - PINNED_COUNT; i < total; i++) set.add(i);

      if (!(this.selected < PINNED_COUNT) && !(this.selected >= total - PINNED_COUNT)) {
        let ge = Math.min(total - PINNED_COUNT - 1, this.selected + Math.floor(GAP_WINDOW / 2));
        let gs = Math.max(PINNED_COUNT, ge - GAP_WINDOW + 1);
        ge = Math.min(total - PINNED_COUNT - 1, gs + GAP_WINDOW - 1);
        for (let i = gs; i <= ge; i++) set.add(i);
      }
      visibleIndices.push(...[...set].sort((a, b) => a - b));
    }

    // ── Render messages ──
    let lastIdx = -1;
    for (const idx of visibleIndices) {
      // Gap
      if (idx > lastIdx + 1 && lastIdx >= 0) {
        const skipped = idx - lastIdx - 1;
        const gapTxt = `${FG_DIM}··· ${skipped} more ···${RST}`;
        lines.push(fillRow(`${barSpace}    ${gapTxt}`, w, BG));
      }

      const msg = this.msgs[idx]!;
      const isSel = idx === this.selected;
      const isExp = this.expanded.has(idx);
      const bg = isSel ? BG_SEL : BG;
      const arrow = isSel && this.focused ? `${FG_ACC}▸${RST}` : " ";
      const numStr = `${FG_FAINT}${String(msg.index).padStart(2)}${RST}`;
      const timeStr = `${FG_TIME}${fmtTime(msg.timestamp)}${RST}`;

      if (isExp) {
        // ── Expanded ──
        const hdrLine = `${barPad}${arrow}${numStr} ${timeStr}`;
        lines.push(fillRow(hdrLine, w, bg));

        const maxTextW = SIDEBAR_WIDTH - 8;
        const wrapped = wrapText(msg.text.replace(/\n/g, " "), maxTextW);
        const maxLines = 8;
        const shown = wrapped.slice(0, maxLines);

        for (const line of shown) {
          lines.push(fillRow(`${barPad}  ${FG_EXP}${line}${RST}`, w, bg));
        }
        if (wrapped.length > maxLines) {
          lines.push(fillRow(`${barPad}  ${FG_DIM}${DIM}…+${wrapped.length - maxLines} lines${RST}`, w, bg));
        }
        // blank separator after expanded
        lines.push(fillRow(`${barPad}`, w, bg));
      } else {
        // ── Collapsed ──
        const maxText = SIDEBAR_WIDTH - 15;
        const text = truncateToWidth(msg.text.replace(/\n/g, " "), maxText, "…");
        const fg = isSel ? FG_BRIGHT : FG_NORM;
        const content = `${barPad}${arrow}${numStr} ${timeStr} ${fg}${text}${RST}`;
        lines.push(fillRow(content, w, bg));
      }

      lastIdx = idx;
    }

    // ── Bottom status cards ──
    const bottomRows = this.renderStatusCards(w, barPad, barSpace);
    while (lines.length < targetH - bottomRows.length) {
      lines.push(fillRow(`${barSpace}`, w, BG));
    }
    lines.push(...bottomRows);

    this.cachedLines = lines;
    this.cachedW = width;
    this.cachedH = targetH;
    this.cachedSig = sig;
    this.lastVer = this.ver;
    return lines;
  }

  private computeUsage() {
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
    let latestCacheHitRate: number | undefined;

    for (const entry of this.ctx.sessionManager.getEntries()) {
      if (entry.type !== "message" || entry.message.role !== "assistant") continue;
      const usage = (entry.message as any).usage ?? {};
      input += usage.input ?? 0;
      output += usage.output ?? 0;
      cacheRead += usage.cacheRead ?? 0;
      cacheWrite += usage.cacheWrite ?? 0;
      cost += usage.cost?.total ?? 0;
      const latestPrompt = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      latestCacheHitRate = latestPrompt > 0 ? ((usage.cacheRead ?? 0) / latestPrompt) * 100 : undefined;
    }

    const ctxUsage = this.ctx.getContextUsage?.();
    return {
      input,
      output,
      cacheRead,
      cacheWrite,
      cost,
      latestCacheHitRate,
      contextPercent: ctxUsage?.percent ?? null,
      contextWindow: ctxUsage?.contextWindow ?? this.ctx.model?.contextWindow ?? 0,
    };
  }

  private renderDockHeader(w: number, pad: string, title: string): string {
    const ruleW = Math.max(0, w - visibleWidth(pad) - title.length - 1);
    return fillRow(`${pad}${FG_FAINT}${title}${RST} ${FG_FAINT}${"─".repeat(ruleW)}${RST}`, w, BG);
  }

  private renderDockRow(w: number, pad: string, label: string, value: string): string {
    const labelW = 5;
    const labelText = `${FG_FAINT}${label.padEnd(labelW)}${RST}`;
    const maxValueW = Math.max(0, w - visibleWidth(pad) - labelW - 1);
    return fillRow(`${pad}${labelText} ${truncateToWidth(value, maxValueW, "…")}`, w, BG_CARD);
  }

  private renderStatusCards(w: number, pad: string, blank: string): string[] {
    const footerData = this.getFooterData();
    const usage = this.computeUsage();
    const rows: string[] = [];

    rows.push(fillRow(`${blank}`, w, BG));
    rows.push(this.renderDockHeader(w, pad, "runtime"));

    const cwd = formatCwd(this.ctx.sessionManager.getCwd());
    const branch = footerData?.getGitBranch();
    const sessionName = this.ctx.sessionManager.getSessionName?.();
    const workspaceBits = [
      `${FG_BRIGHT}${cwd}${RST}`,
      branch ? `${FG_ACC}${branch}${RST}` : undefined,
      sessionName ? `${FG_MID}${sessionName}${RST}` : undefined,
    ].filter(Boolean).join(` ${FG_FAINT}•${RST} `);
    rows.push(this.renderDockRow(w, pad, "cwd", workspaceBits));

    const model = this.ctx.model;
    if (model) {
      const providerPrefix = footerData && footerData.getAvailableProviderCount() > 1 ? `${FG_FAINT}${model.provider}${RST} ` : "";
      const thinking = model.reasoning ? ` ${FG_FAINT}•${RST} ${FG_MID}${this.getThinkingLevel()}${RST}` : "";
      rows.push(this.renderDockRow(w, pad, "model", `${providerPrefix}${FG_BRIGHT}${model.id}${RST}${thinking}`));
    }

    const usingSub = model ? Boolean((this.ctx.modelRegistry as any).isUsingOAuth?.(model)) : false;
    const contextPercent = usage.contextPercent;
    const contextDisplay = contextPercent === null
      ? `?/${formatTokens(usage.contextWindow)}`
      : `${contextPercent.toFixed(1)}%/${formatTokens(usage.contextWindow)}`;
    const costDisplay = `$${usage.cost.toFixed(3)}${usingSub ? " sub" : ""}`;
    const tokenParts = [
      usage.input ? `↑${formatTokens(usage.input)}` : undefined,
      usage.output ? `↓${formatTokens(usage.output)}` : undefined,
      usage.cacheRead ? `R${formatTokens(usage.cacheRead)}` : undefined,
      usage.cacheWrite ? `W${formatTokens(usage.cacheWrite)}` : undefined,
      usage.latestCacheHitRate !== undefined && (usage.cacheRead || usage.cacheWrite) ? `CH${usage.latestCacheHitRate.toFixed(1)}%` : undefined,
    ].filter(Boolean).join(" ");
    rows.push(this.renderDockRow(w, pad, "ctx", `${contextColor(contextPercent)}${contextDisplay}${RST} ${progressBar(contextPercent, 10)}`));
    rows.push(this.renderDockRow(w, pad, "use", `${FG_BRIGHT}${costDisplay}${RST}${tokenParts ? ` ${FG_FAINT}•${RST} ${FG_MID}${tokenParts}${RST}` : ` ${FG_FAINT}• no token usage${RST}`}`));

    const statuses = footerData ? [...footerData.getExtensionStatuses().entries()].sort(([a], [b]) => a.localeCompare(b)) : [];
    for (const [, text] of statuses.slice(0, 2)) {
      rows.push(this.renderDockRow(w, pad, "stat", `${FG_INFO}•${RST} ${FG_MID}${sanitizeStatusText(text)}${RST}`));
    }

    rows.push(fillRow(`${blank}`, w, BG));
    const hint = this.focused
      ? `${FG_DIM}↑↓${RST} ${FG_MID}nav${RST} ${FG_FAINT}·${RST} ${FG_DIM}Enter${RST} ${FG_MID}expand${RST} ${FG_FAINT}·${RST} ${FG_DIM}Esc${RST} ${FG_MID}done${RST}`
      : `${FG_DIM}Ctrl+Shift+H${RST} ${FG_MID}focus${RST}`;
    rows.push(fillRow(`${pad}${truncateToWidth(hint, w - visibleWidth(pad), "…")}`, w, BG_HDR));

    return rows;
  }

  invalidate() { this.cachedW = -1; this.cachedH = -1; this.cachedSig = ""; this.cachedLines = []; this.lastVer = -1; }
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let sidebarRef: SidebarComponent | null = null;
  let overlayHandle: any = null;
  let cachedCtx: ExtensionContext | null = null;
  let footerDataRef: FooterData | null = null;
  let launched = false;
  let refreshQueued = false;

  function scheduleRefresh(ctx: ExtensionContext | null = cachedCtx) {
    if (refreshQueued) return;
    refreshQueued = true;
    // Extension message_end fires before Pi persists the finalized message.
    // Defer one event-loop turn so usage/message totals read from sessionManager are current.
    setImmediate(() => {
      refreshQueued = false;
      const activeCtx = ctx ?? cachedCtx;
      if (sidebarRef && activeCtx) sidebarRef.updateMessages(collectUserMessages(activeCtx));
      else sidebarRef?.refresh();
    });
  }

  function launch(ctx: ExtensionContext) {
    if (launched || ctx.mode !== "tui") return;
    launched = true;
    cachedCtx = ctx;
    const msgs = collectUserMessages(ctx);

    ctx.ui.custom<undefined>(
      (tui, _theme, _kb, done) => {
        sidebarRef = new SidebarComponent(
          tui,
          ctx,
          () => footerDataRef,
          () => pi.getThinkingLevel(),
          msgs,
          done,
        );
        return sidebarRef;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "top-right",
          width: SIDEBAR_WIDTH,
          maxHeight: "100%",
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
          visible: (termWidth: number) => termWidth >= MIN_MAIN_WIDTH + RESERVED_WIDTH,
          nonCapturing: true,
        },
        onHandle: (handle) => { overlayHandle = handle; },
      },
    ).then(() => { launched = false; sidebarRef = null; overlayHandle = null; cachedCtx = null; });
  }

  function toggleFocus(ctx: ExtensionContext) {
    if (!launched) { launch(ctx); return; }
    if (!sidebarRef || !overlayHandle) return;
    if (sidebarRef.isFocused()) { sidebarRef.setFocused(false); overlayHandle.unfocus(); }
    else { sidebarRef.setFocused(true); overlayHandle.focus(); }
  }

  pi.on("session_start", (_e, ctx) => {
    if (ctx.mode === "tui") {
      ctx.ui.setWidget(
        "message-sidebar-layout-reserve",
        (tui) => new LayoutReserveComponent(tui),
        { placement: "belowEditor" },
      );

      ctx.ui.setFooter((tui, _theme, footerData) => {
        footerDataRef = footerData as FooterData;
        scheduleRefresh(ctx);
        return new FooterBridgeComponent(
          footerData as FooterData,
          () => scheduleRefresh(ctx),
          () => {
            if (footerDataRef === footerData) footerDataRef = null;
          },
        );
      });
    }
    launch(ctx);
  });

  pi.registerShortcut("ctrl+shift+h", {
    description: "Focus/unfocus message sidebar",
    handler: (ctx) => toggleFocus(ctx),
  });

  pi.registerCommand("sidebar", {
    description: "Toggle message sidebar focus (Ctrl+Shift+H)",
    handler: (_a, ctx) => toggleFocus(ctx),
  });

  pi.on("message_end", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("turn_end", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("agent_end", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("model_select", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("thinking_level_select", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("session_compact", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("session_tree", (_event, ctx) => scheduleRefresh(ctx));

  pi.on("session_start", (_e, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.onTerminalInput((data: string) => {
      if (matchesKey(data, "escape") && sidebarRef?.isFocused() && overlayHandle?.isFocused()) {
        sidebarRef.setFocused(false);
        overlayHandle.unfocus();
        return { consume: true };
      }
      return undefined;
    });
  });
}
