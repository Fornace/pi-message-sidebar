import { basename } from "node:path";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const BG = "\x1b[48;5;232m";
export const BG_SEL = "\x1b[48;5;235m";
export const BG_HDR = "\x1b[48;5;233m";
export const BG_CARD = "\x1b[48;5;234m";
export const FG_FAINT = "\x1b[38;5;240m";
export const FG_DIM = "\x1b[38;5;243m";
export const FG_MID = "\x1b[38;5;248m";
export const FG_NORM = "\x1b[38;5;250m";
export const FG_BRIGHT = "\x1b[38;5;255m";
export const FG_ACC = "\x1b[38;5;75m";
export const FG_INFO = "\x1b[38;5;80m";
export const FG_OK = "\x1b[38;5;114m";
export const FG_WARN = "\x1b[38;5;215m";
export const FG_ERR = "\x1b[38;5;203m";
export const FG_TIME = "\x1b[38;5;242m";
export const FG_EXP = "\x1b[38;5;252m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const RST = "\x1b[0m";

export function fillRow(content: string, width: number, bg: string): string {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth === 0) return "";
  const injected = content.replace(/\x1b\[0m/g, `${RST}${bg}`);
  return `${bg}${truncateToWidth(injected, safeWidth, "", true)}${RST}`;
}

export function wrapText(text: string, width: number): string[] {
  return wrapTextWithAnsi(text.replace(/\s+/g, " ").trim(), Math.max(1, width));
}

export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export function formatTokens(count: number): string {
  if (!count) return "0";
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

export function contextColor(percent: number | null): string {
  if (percent === null) return FG_DIM;
  if (percent > 90) return FG_ERR;
  if (percent > 70) return FG_WARN;
  return FG_OK;
}

export function progressBar(percent: number | null, width = 10): string {
  if (percent === null) return `${FG_DIM}${"░".repeat(width)}${RST}`;
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return `${contextColor(percent)}${"█".repeat(filled)}${FG_DIM}${"░".repeat(width - filled)}${RST}`;
}

export function formatCwd(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && cwd === home) return "~";
  if (home && cwd.startsWith(`${home}/`)) return `~/${cwd.slice(home.length + 1)}`;
  return basename(cwd) || cwd;
}

export function contentWidth(width: number, prefix: string, suffix = 0): number {
  return Math.max(0, width - visibleWidth(prefix) - suffix);
}
