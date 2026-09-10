import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const BG = "\x1b[48;5;232m";
export const BG_SEL = "\x1b[48;5;237m";
export const BG_HDR = "\x1b[48;5;233m";
export const BG_CARD = "\x1b[48;5;234m";
export const BG_DETAIL = "\x1b[48;5;235m";
export const FG_RULE = "\x1b[38;5;240m";
export const FG_SECONDARY = "\x1b[38;5;246m";
export const FG_PRIMARY = "\x1b[38;5;252m";
export const FG_STATUS_ACTIVE = "\x1b[38;5;117m";
export const FG_STATUS_DONE = "\x1b[38;5;150m";
export const FG_STATUS_WAIT = "\x1b[38;5;221m";
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

export function formatCost(cost: number): string {
  if (!Number.isFinite(cost)) return "$?";
  if (cost >= 1000) return `$${(cost / 1000).toFixed(2)}k`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatElapsed(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "?";
  const seconds = Math.floor(totalSeconds);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${String(hours % 24).padStart(2, "0")}h`;
}

export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${hours}h`;
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
  return cwd;
}

/**
 * Trims a path from the front so the identifying tail survives; a plain
 * truncation would leave every deep directory reading the same.
 */
export function ellipsizePath(path: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(path) <= width) return path;
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index++) {
    const candidate = `…/${parts.slice(index).join("/")}`;
    if (visibleWidth(candidate) <= width) return candidate;
  }
  return `…${truncateToWidth(parts.at(-1) ?? path, Math.max(0, width - 1), "")}`;
}

export function contentWidth(width: number, prefix: string, suffix = 0): number {
  return Math.max(0, width - visibleWidth(prefix) - suffix);
}
