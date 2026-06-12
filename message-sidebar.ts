/**
 * Message Sidebar — persistent right-side overlay showing user message history
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
 * Zero timers. Cached rendering. Pure ANSI 256-color — no GPU cost.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── Config ──────────────────────────────────────────────────────────────────
const SIDEBAR_WIDTH = 40;
const PINNED_COUNT = 5;
const GAP_WINDOW = 3;

// ── ANSI palette (256-color, no truecolor — terminal-native, zero GPU) ──────
const BG       = "\x1b[48;5;235m";  // very dark grey
const BG_SEL   = "\x1b[48;5;238m";  // selected row
const BG_FOCUS = "\x1b[48;5;236m";  // focused-mode border tint
const FG_DIM   = "\x1b[38;5;245m";
const FG_NORM  = "\x1b[38;5;252m";
const FG_ACC   = "\x1b[38;5;117m";  // accent (header, arrows)
const FG_SEL   = "\x1b[38;5;230m";  // selected text
const FG_EXP   = "\x1b[38;5;250m";  // expanded text
const RST      = "\x1b[0m";

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
        msgs.push({ id: entry.id, text: text.trim(), index: idx });
      }
    }
  }
  return msgs;
}

/** Simple word-wrap that respects ANSI codes (visible-width aware). */
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
  private tui: { requestRender: () => void };

  // Cache
  private cachedW = -1;
  private cachedLines: string[] = [];
  private ver = 0;
  private lastVer = -1;

  constructor(
    tui: { requestRender: () => void },
    msgs: UserMsg[],
    done: (result: undefined) => void,
  ) {
    this.tui = tui;
    this.msgs = msgs;
    this.done = done;
    this.selected = msgs.length > 0 ? msgs.length - 1 : 0;
  }

  // ── Public API (called by extension) ──

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

  // ── Input (only received when overlay is focused) ──

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.setFocused(false);
      // Release focus back to editor — the extension handles this via overlayHandle
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
      // Toggle expand/collapse
      if (this.expanded.has(this.selected)) {
        this.expanded.delete(this.selected);
      } else {
        this.expanded.add(this.selected);
      }
      this.ver++; this.tui.requestRender();
      return;
    }
  }

  // ── Render ──

  render(width: number): string[] {
    if (width === this.cachedW && this.lastVer === this.ver) {
      return this.cachedLines;
    }

    const w = Math.min(SIDEBAR_WIDTH, width);
    const innerW = w - 2;
    const lines: string[] = [];
    const fBorder = this.focused ? FG_ACC : FG_DIM;

    const bdr = (s: string) => fBorder + s + RST;
    const row = (content: string, bg: string) => {
      const vis = visibleWidth(content);
      const pad = Math.max(0, innerW - vis);
      return bdr("│") + bg + content + " ".repeat(pad) + RST + bdr("│");
    };

    // ── Header ──
    lines.push(bdr(`╭${"─".repeat(innerW)}╮`));
    const modeLabel = this.focused
      ? `${FG_ACC}● FOCUSED${RST}${BG}`
      : `${FG_DIM}○ passive${RST}${BG}`;
    const hdr = `${BG}${FG_ACC}Msgs${RST}${BG} ${FG_DIM}(${this.msgs.length})${RST}${BG} ${modeLabel}${RST}`;
    lines.push(row(hdr, BG));
    lines.push(bdr(`├${"─".repeat(innerW)}┤`));

    // ── Empty state ──
    if (this.msgs.length === 0) {
      lines.push(row(`${BG}${FG_DIM}  No messages yet${RST}`, BG));
      lines.push(bdr(`╰${"─".repeat(innerW)}╯`));
      this.cachedLines = lines; this.cachedW = width; this.lastVer = this.ver;
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

    // ── Render rows ──
    let lastIdx = -1;
    for (const idx of visibleIndices) {
      // Gap indicator
      if (idx > lastIdx + 1 && lastIdx >= 0) {
        const skipped = idx - lastIdx - 1;
        const gapTxt = `${BG}${FG_DIM}  ··· ${skipped} more ···${RST}`;
        lines.push(row(gapTxt, BG));
      }

      const msg = this.msgs[idx]!;
      const isSel = idx === this.selected;
      const isExp = this.expanded.has(idx);
      const bg = isSel ? BG_SEL : BG;
      const fg = isSel ? FG_SEL : FG_NORM;
      const arrow = isSel && this.focused ? `${FG_ACC}▶${RST}` : " ";

      // Index label
      const numStr = `${FG_DIM}${String(msg.index).padStart(2)}${RST}`;

      if (isExp) {
        // ── Expanded: multi-line ──
        const maxTextW = SIDEBAR_WIDTH - 6;
        const wrapped = wrapAnsi(msg.text.replace(/\n/g, " "), maxTextW);
        const maxLines = 6; // cap expanded height
        const shown = wrapped.slice(0, maxLines);
        const truncated = wrapped.length > maxLines;

        for (let li = 0; li < shown.length; li++) {
          const line = shown[li]!;
          if (li === 0) {
            const content = `${bg}${arrow}${numStr} ${fg}${line}${RST}`;
            lines.push(row(content, bg));
          } else {
            const indent = "    ";
            const content = `${bg}${FG_DIM}${indent}${RST}${FG_EXP}${line}${RST}`;
            lines.push(row(content, bg));
          }
        }
        if (truncated) {
          const more = `${bg}${FG_DIM}     …+${wrapped.length - maxLines} lines${RST}`;
          lines.push(row(more, bg));
        }
      } else {
        // ── Collapsed: single line ──
        const maxText = SIDEBAR_WIDTH - 7;
        const text = truncateToWidth(msg.text.replace(/\n/g, " "), maxText, "…");
        const content = `${bg}${arrow}${numStr} ${fg}${text}${RST}`;
        lines.push(row(content, bg));
      }

      lastIdx = idx;
    }

    // ── Footer ──
    lines.push(bdr(`├${"─".repeat(innerW)}┤`));
    if (this.focused) {
      const f1 = `${FG_DIM} ↑↓ nav  Enter expand  Esc done${RST}`;
      lines.push(row(`${BG}${f1}`, BG));
    } else {
      const f1 = `${FG_DIM} Ctrl+Shift+H to navigate${RST}`;
      lines.push(row(`${BG}${f1}`, BG));
    }
    lines.push(bdr(`╰${"─".repeat(innerW)}╯`));

    this.cachedLines = lines;
    this.cachedW = width;
    this.lastVer = this.ver;
    return lines;
  }

  invalidate(): void {
    this.cachedW = -1;
    this.cachedLines = [];
    this.lastVer = -1;
  }
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let sidebarRef: SidebarComponent | null = null;
  let overlayHandle: { focus: () => void; unfocus: () => void; setHidden: (h: boolean) => void; hide: () => void; isFocused: () => boolean } | null = null;
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
          anchor: "right-center",
          width: SIDEBAR_WIDTH,
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

  // ── Launch sidebar on session start ──
  pi.on("session_start", (_event, ctx) => {
    launchSidebar(ctx);
  });

  // ── Ctrl+Shift+H: toggle focus ──
  pi.registerShortcut("ctrl+shift+h", {
    description: "Focus/unfocus message sidebar",
    handler: (ctx) => {
      if (!launched) {
        launchSidebar(ctx);
        return;
      }
      if (!sidebarRef || !overlayHandle) return;

      if (sidebarRef.isFocused()) {
        // Unfocus → back to editor
        sidebarRef.setFocused(false);
        overlayHandle.unfocus();
      } else {
        // Focus → sidebar captures keys
        sidebarRef.setFocused(true);
        overlayHandle.focus();
      }
    },
  });

  // ── Also register as command ──
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

  // ── Refresh messages on new user input ──
  pi.on("message_end", (_event, _ctx) => {
    if (sidebarRef && cachedCtx) {
      const msgs = collectUserMessages(cachedCtx);
      sidebarRef.updateMessages(msgs);
    }
  });

  // ── Handle Escape from sidebar (unfocus overlay) ──
  // The sidebar component sets focused=false on Escape internally,
  // but we also need to tell the overlay system to release focus.
  // We do this via onTerminalInput: when Escape is pressed and sidebar
  // was focused, we call overlayHandle.unfocus().
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
