/**
 * Message Sidebar — full-height, modern, borderless overlay
 *
 * Always visible in passive mode. Ctrl+Shift+H focuses for navigation.
 *
 * Design: no box borders, left accent bar, flat dark background,
 * consistent fill via BG-injection after every ANSI reset.
 *
 * Focused mode (Ctrl+Shift+H):
 *   - ↑/↓          navigate all messages
 *   - Enter/Space   toggle expand/collapse
 *   - PageUp/Dn     jump 10 messages
 *   - Home/End      first/last message
 *   - Escape        return to passive mode
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── Config ──────────────────────────────────────────────────────────────────
const SIDEBAR_WIDTH = 42;
const PINNED_COUNT = 5;
const GAP_WINDOW = 3;

// ── Palette ─────────────────────────────────────────────────────────────────
const BG       = "\x1b[48;5;235m";  // panel background
const BG_SEL   = "\x1b[48;5;237m";  // selected row
const BG_HDR   = "\x1b[48;5;234m";  // header (slightly darker)

const FG_DIM   = "\x1b[38;5;243m";
const FG_MID   = "\x1b[38;5;248m";
const FG_NORM  = "\x1b[38;5;250m";
const FG_BRIGHT= "\x1b[38;5;255m";
const FG_ACC   = "\x1b[38;5;75m";   // blue accent
const FG_TIME  = "\x1b[38;5;245m";
const FG_EXP   = "\x1b[38;5;252m";  // expanded text
const FG_DOT   = "\x1b[38;5;114m";  // green dot (focused)

const BOLD     = "\x1b[1m";
const DIM      = "\x1b[2m";
const RST      = "\x1b[0m";

// Left accent bar character
const BAR = "▎";

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

// ── Sidebar Component ───────────────────────────────────────────────────────

class SidebarComponent {
  private focused = false;
  private selected = 0;
  private expanded = new Set<number>();
  private msgs: UserMsg[] = [];
  private done: (result: undefined) => void;
  private tui: any;

  private cachedW = -1;
  private cachedH = -1;
  private cachedLines: string[] = [];
  private ver = 0;
  private lastVer = -1;

  constructor(tui: any, msgs: UserMsg[], done: (result: undefined) => void) {
    this.tui = tui;
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

  render(width: number): string[] {
    const termH = this.tui.terminal?.rows ?? 40;
    const targetH = Math.max(15, termH - 2);

    if (width === this.cachedW && targetH === this.cachedH && this.lastVer === this.ver) {
      return this.cachedLines;
    }

    const w = Math.min(SIDEBAR_WIDTH, width);
    const lines: string[] = [];

    // Accent bar color
    const barColor = this.focused ? FG_ACC : FG_DIM;
    const bar = `${barColor}${BAR}${RST}`;
    const pad = "  "; // 2 spaces after bar
    const barPad = `${bar}${pad}`;
    const barSpace = `${FG_DIM}${BAR}${RST}${pad}`;

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

    // Thin separator
    const sep = `${FG_DIM}${"─".repeat(w - 2)}${RST}`;
    lines.push(fillRow(`${barSpace}${sep}`, w, BG));

    // ── Empty state ──
    if (this.msgs.length === 0) {
      lines.push(fillRow(`${barPad}`, w, BG)); // blank
      lines.push(fillRow(`${barPad}${FG_DIM}No messages yet${RST}`, w, BG));
      lines.push(fillRow(`${barPad}`, w, BG)); // blank
      while (lines.length < targetH - 3) lines.push(fillRow(`${barSpace}`, w, BG));
      lines.push(fillRow(`${barPad}`, w, BG)); // blank before footer
      this.cachedLines = lines; this.cachedW = width; this.cachedH = targetH; this.lastVer = this.ver;
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
      const numStr = `${FG_DIM}${String(msg.index).padStart(2)}${RST}`;
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

    // ── Fill remaining ──
    while (lines.length < targetH - 3) {
      lines.push(fillRow(`${barSpace}`, w, BG));
    }

    // ── Footer ──
    lines.push(fillRow(`${barPad}`, w, BG)); // blank before footer
    if (this.focused) {
      lines.push(fillRow(`${barPad}${FG_DIM}↑↓${RST} ${FG_MID}nav${RST}  ${FG_DIM}Enter${RST} ${FG_MID}expand${RST}  ${FG_DIM}Esc${RST} ${FG_MID}close${RST}`, w, BG));
    } else {
      lines.push(fillRow(`${barPad}${FG_DIM}Ctrl+Shift+H to navigate${RST}`, w, BG));
    }

    this.cachedLines = lines;
    this.cachedW = width;
    this.cachedH = targetH;
    this.lastVer = this.ver;
    return lines;
  }

  invalidate() { this.cachedW = -1; this.cachedH = -1; this.cachedLines = []; this.lastVer = -1; }
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let sidebarRef: SidebarComponent | null = null;
  let overlayHandle: any = null;
  let cachedCtx: ExtensionContext | null = null;
  let launched = false;

  function launch(ctx: ExtensionContext) {
    if (launched || ctx.mode !== "tui") return;
    launched = true;
    cachedCtx = ctx;
    const msgs = collectUserMessages(ctx);

    ctx.ui.custom<undefined>(
      (tui, _theme, _kb, done) => {
        sidebarRef = new SidebarComponent(tui, msgs, done);
        return sidebarRef;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "top-right",
          width: SIDEBAR_WIDTH,
          maxHeight: "100%",
          margin: { top: 2, right: 0, bottom: 0, left: 1 },
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

  pi.on("session_start", (_e, ctx) => { launch(ctx); });

  pi.registerShortcut("ctrl+shift+h", {
    description: "Focus/unfocus message sidebar",
    handler: (ctx) => toggleFocus(ctx),
  });

  pi.registerCommand("sidebar", {
    description: "Toggle message sidebar focus (Ctrl+Shift+H)",
    handler: (_a, ctx) => toggleFocus(ctx),
  });

  pi.on("message_end", () => {
    if (sidebarRef && cachedCtx) sidebarRef.updateMessages(collectUserMessages(cachedCtx));
  });

  pi.on("session_start", (_e, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.onTerminalInput((data: string) => {
      if (matchesKey(data, "escape") && sidebarRef && !sidebarRef.isFocused() && overlayHandle?.isFocused()) {
        overlayHandle.unfocus();
        return { consume: false };
      }
      return undefined;
    });
  });
}
