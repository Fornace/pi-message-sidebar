/**
 * Message Sidebar — full-height persistent overlay with elegant styling
 *
 * Always visible in passive mode. Ctrl+Shift+H focuses for navigation.
 *
 * Passive mode:
 *   - Shows first N and last N user messages (truncated)
 *   - No keyboard interaction
 *
 * Focused mode (Ctrl+Shift+H):
 *   - ↑/↓          navigate all messages
 *   - Enter/Space   toggle expand/collapse of selected message
 *   - PageUp/Dn     jump 10 messages
 *   - Home/End      first/last message
 *   - Escape        return to passive mode (sidebar stays visible)
 *
 * First N and last N messages are always pinned at top/bottom.
 * The middle section scrolls to follow the selection when in the gap.
 *
 * Full terminal height. Elegant double-border styling. Zero GPU cost.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── Config ──────────────────────────────────────────────────────────────────
const SIDEBAR_WIDTH = 42;
const PINNED_COUNT = 5;
const GAP_WINDOW = 3;

// ── Elegant ANSI palette (256-color) ────────────────────────────────────────
const BG_DARK    = "\x1b[48;5;234m";  // darkest grey (main bg)
const BG_MID     = "\x1b[48;5;236m";  // medium grey (selected)
const BG_LIGHT   = "\x1b[48;5;238m";  // lighter grey (hover/active)
const BG_ACCENT  = "\x1b[48;5;24m";   // deep blue accent (focused header)

const FG_DIM     = "\x1b[38;5;242m";  // dim grey
const FG_MID     = "\x1b[38;5;248m";  // medium grey
const FG_NORM    = "\x1b[38;5;252m";  // light grey
const FG_BRIGHT  = "\x1b[38;5;255m";  // white
const FG_ACCENT  = "\x1b[38;5;75m";   // bright blue
const FG_GOLD    = "\x1b[38;5;220m";  // gold/yellow
const FG_GREEN   = "\x1b[38;5;114m";  // soft green
const FG_CYAN    = "\x1b[38;5;87m";   // cyan

const BOLD       = "\x1b[1m";
const ITALIC     = "\x1b[3m";
const RST        = "\x1b[0m";

// Double-border characters
const DB = {
  tl: "╔", tr: "╗", bl: "╚", br: "╝",
  h: "═", v: "║",
  lmid: "╠", rmid: "╣", tmid: "╦", bmid: "╩",
};

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
        msgs.push({
          id: entry.id,
          text: text.trim(),
          index: idx,
          timestamp: entry.timestamp,
        });
      }
    }
  }
  return msgs;
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  } catch {
    return "";
  }
}

function wrapAnsi(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (visibleWidth(test) > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
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

  // Cache
  private cachedW = -1;
  private cachedH = -1;
  private cachedLines: string[] = [];
  private ver = 0;
  private lastVer = -1;

  constructor(
    tui: any,
    msgs: UserMsg[],
    done: (result: undefined) => void,
  ) {
    this.tui = tui;
    this.msgs = msgs;
    this.done = done;
    this.selected = msgs.length > 0 ? msgs.length - 1 : 0;
  }

  setFocused(f: boolean): void {
    if (this.focused !== f) {
      this.focused = f;
      this.ver++;
      this.tui.requestRender();
    }
  }

  isFocused(): boolean {
    return this.focused;
  }

  updateMessages(msgs: UserMsg[]): void {
    this.msgs = msgs;
    if (this.selected >= msgs.length) this.selected = Math.max(0, msgs.length - 1);
    this.ver++;
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.setFocused(false);
      return;
    }
    if (matchesKey(data, "up")) {
      if (this.selected > 0) { this.selected--; this.ver++; this.tui.requestRender(); }
      return;
    }
    if (matchesKey(data, "down")) {
      if (this.selected < this.msgs.length - 1) { this.selected++; this.ver++; this.tui.requestRender(); }
      return;
    }
    if (matchesKey(data, "pageUp")) {
      this.selected = Math.max(0, this.selected - 10);
      this.ver++; this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "pageDown")) {
      this.selected = Math.min(this.msgs.length - 1, this.selected + 10);
      this.ver++; this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "home")) {
      this.selected = 0; this.ver++; this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "end")) {
      this.selected = this.msgs.length - 1; this.ver++; this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter") || data === " ") {
      if (this.expanded.has(this.selected)) {
        this.expanded.delete(this.selected);
      } else {
        this.expanded.add(this.selected);
      }
      this.ver++; this.tui.requestRender();
      return;
    }
  }

  render(width: number): string[] {
    // Get terminal height
    const termHeight = this.tui.terminal?.rows ?? 40;
    const targetHeight = Math.max(20, termHeight - 4); // leave margin

    if (width === this.cachedW && targetHeight === this.cachedH && this.lastVer === this.ver) {
      return this.cachedLines;
    }

    const w = Math.min(SIDEBAR_WIDTH, width);
    const innerW = w - 2;
    const lines: string[] = [];

    // ── Border styling based on focus state ──
    const borderFG = this.focused ? FG_ACCENT : FG_MID;
    const headerBG = this.focused ? BG_ACCENT : BG_DARK;
    const bdr = (s: string) => borderFG + s + RST;

    const row = (content: string, bg: string = BG_DARK) => {
      const vis = visibleWidth(content);
      const pad = Math.max(0, innerW - vis);
      return bdr(DB.v) + bg + content + " ".repeat(pad) + RST + bdr(DB.v);
    };

    const emptyRow = (bg: string = BG_DARK) => {
      return bdr(DB.v) + bg + " ".repeat(innerW) + RST + bdr(DB.v);
    };

    // ── Header (double border) ──
    lines.push(bdr(`${DB.tl}${DB.h.repeat(innerW)}${DB.tr}`));

    // Title bar
    const icon = this.focused ? `${FG_GOLD}◆${RST}${headerBG}` : `${FG_MID}◇${RST}${headerBG}`;
    const title = `${headerBG} ${icon} ${BOLD}${FG_BRIGHT}Messages${RST}${headerBG} ${FG_MID}(${this.msgs.length})${RST}`;
    lines.push(row(title, headerBG));

    // Mode indicator
    const modeText = this.focused
      ? `${headerBG}   ${FG_GREEN}${BOLD}● FOCUSED${RST}${headerBG} ${FG_DIM}${ITALIC}navigate & expand${RST}`
      : `${headerBG}   ${FG_MID}○ passive${RST}${headerBG} ${FG_DIM}${ITALIC}view only${RST}`;
    lines.push(row(modeText, headerBG));

    lines.push(bdr(`${DB.lmid}${DB.h.repeat(innerW)}${DB.rmid}`));

    // ── Empty state ──
    if (this.msgs.length === 0) {
      lines.push(emptyRow());
      const emptyMsg = `${BG_DARK}  ${FG_DIM}${ITALIC}No messages yet${RST}`;
      lines.push(row(emptyMsg));
      lines.push(emptyRow());

      // Fill to target height
      while (lines.length < targetHeight - 1) {
        lines.push(emptyRow());
      }
      lines.push(bdr(`${DB.bl}${DB.h.repeat(innerW)}${DB.br}`));
      this.cachedLines = lines; this.cachedW = width; this.cachedH = targetHeight; this.lastVer = this.ver;
      return lines;
    }

    // ── Determine visible indices ──
    const total = this.msgs.length;
    const showAll = total <= PINNED_COUNT * 2 + 1;

    const visibleIndices: number[] = [];

    if (showAll) {
      for (let i = 0; i < total; i++) visibleIndices.push(i);
    } else {
      const set = new Set<number>();
      for (let i = 0; i < PINNED_COUNT; i++) set.add(i);
      for (let i = total - PINNED_COUNT; i < total; i++) set.add(i);

      const inFirst = this.selected < PINNED_COUNT;
      const inLast = this.selected >= total - PINNED_COUNT;

      if (!inFirst && !inLast) {
        let gapEnd = Math.min(total - PINNED_COUNT - 1, this.selected + Math.floor(GAP_WINDOW / 2));
        let gapStart = Math.max(PINNED_COUNT, gapEnd - GAP_WINDOW + 1);
        gapEnd = Math.min(total - PINNED_COUNT - 1, gapStart + GAP_WINDOW - 1);
        for (let i = gapStart; i <= gapEnd; i++) set.add(i);
      }

      visibleIndices.push(...[...set].sort((a, b) => a - b));
    }

    // ── Render message rows ──
    let lastIdx = -1;
    for (const idx of visibleIndices) {
      // Gap indicator
      if (idx > lastIdx + 1 && lastIdx >= 0) {
        const skipped = idx - lastIdx - 1;
        const gapLine = `${BG_DARK}${FG_DIM}  ${"─".repeat(3)} ${skipped} more ${"─".repeat(3)}${RST}`;
        lines.push(row(gapLine));
      }

      const msg = this.msgs[idx]!;
      const isSel = idx === this.selected;
      const isExp = this.expanded.has(idx);
      const bg = isSel ? BG_MID : BG_DARK;
      const fg = isSel ? FG_BRIGHT : FG_NORM;
      const arrow = isSel && this.focused ? `${FG_GOLD}▶${RST}` : " ";
      const timeStr = formatTime(msg.timestamp);

      if (isExp) {
        // ── Expanded: multi-line ──
        const maxTextW = SIDEBAR_WIDTH - 6;
        const wrapped = wrapAnsi(msg.text.replace(/\n/g, " "), maxTextW);
        const maxLines = 8;
        const shown = wrapped.slice(0, maxLines);
        const truncated = wrapped.length > maxLines;

        // Header line with index and time
        const header = `${bg}${arrow}${FG_DIM}${String(msg.index).padStart(2)}${RST}${bg} ${FG_CYAN}${timeStr}${RST}`;
        lines.push(row(header, bg));

        // Content lines
        for (const line of shown) {
          const content = `${bg}   ${FG_BRIGHT}${line}${RST}`;
          lines.push(row(content, bg));
        }

        if (truncated) {
          const more = `${bg}   ${FG_DIM}${ITALIC}…+${wrapped.length - maxLines} lines${RST}`;
          lines.push(row(more, bg));
        }

        // Separator
        lines.push(emptyRow(bg));
      } else {
        // ── Collapsed: single line ──
        const maxText = SIDEBAR_WIDTH - 12; // account for index, time, spacing
        const text = truncateToWidth(msg.text.replace(/\n/g, " "), maxText, "…");
        const content = `${bg}${arrow}${FG_DIM}${String(msg.index).padStart(2)}${RST}${bg} ${FG_CYAN}${timeStr}${RST}${bg} ${fg}${text}${RST}`;
        lines.push(row(content, bg));
      }

      lastIdx = idx;
    }

    // ── Fill remaining space ──
    while (lines.length < targetHeight - 2) {
      lines.push(emptyRow());
    }

    // ── Footer ──
    lines.push(bdr(`${DB.lmid}${DB.h.repeat(innerW)}${DB.rmid}`));
    if (this.focused) {
      const help1 = `${BG_DARK} ${FG_GOLD}↑↓${RST}${BG_DARK} nav  ${FG_GOLD}Enter${RST}${BG_DARK} expand  ${FG_GOLD}Esc${RST}${BG_DARK} done${RST}`;
      lines.push(row(help1));
    } else {
      const help1 = `${BG_DARK} ${FG_DIM}${ITALIC}Ctrl+Shift+H to navigate${RST}`;
      lines.push(row(help1));
    }
    lines.push(bdr(`${DB.bl}${DB.h.repeat(innerW)}${DB.br}`));

    this.cachedLines = lines;
    this.cachedW = width;
    this.cachedH = targetHeight;
    this.lastVer = this.ver;
    return lines;
  }

  invalidate(): void {
    this.cachedW = -1;
    this.cachedH = -1;
    this.cachedLines = [];
    this.lastVer = -1;
  }
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let sidebarRef: SidebarComponent | null = null;
  let overlayHandle: any = null;
  let cachedCtx: ExtensionContext | null = null;
  let launched = false;

  function launchSidebar(ctx: ExtensionContext) {
    if (launched) return;
    if (ctx.mode !== "tui") return;

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
          maxHeight: "95%",
          margin: { top: 1, right: 0, bottom: 1, left: 1 },
          nonCapturing: true,
        },
        onHandle: (handle) => {
          overlayHandle = handle;
        },
      },
    ).then(() => {
      launched = false;
      sidebarRef = null;
      overlayHandle = null;
      cachedCtx = null;
    });
  }

  pi.on("session_start", (_event, ctx) => {
    launchSidebar(ctx);
  });

  pi.registerShortcut("ctrl+shift+h", {
    description: "Focus/unfocus message sidebar",
    handler: (ctx) => {
      if (!launched) {
        launchSidebar(ctx);
        return;
      }
      if (!sidebarRef || !overlayHandle) return;

      if (sidebarRef.isFocused()) {
        sidebarRef.setFocused(false);
        overlayHandle.unfocus();
      } else {
        sidebarRef.setFocused(true);
        overlayHandle.focus();
      }
    },
  });

  pi.registerCommand("sidebar", {
    description: "Toggle message sidebar focus (Ctrl+Shift+H)",
    handler: (_args, ctx) => {
      if (!launched) {
        launchSidebar(ctx);
        return;
      }
      if (!sidebarRef || !overlayHandle) return;

      if (sidebarRef.isFocused()) {
        sidebarRef.setFocused(false);
        overlayHandle.unfocus();
      } else {
        sidebarRef.setFocused(true);
        overlayHandle.focus();
      }
    },
  });

  pi.on("message_end", (_event, _ctx) => {
    if (sidebarRef && cachedCtx) {
      const msgs = collectUserMessages(cachedCtx);
      sidebarRef.updateMessages(msgs);
    }
  });

  pi.on("session_start", (_event, ctx) => {
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
