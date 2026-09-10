import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const BOLD = "\x1b[1m";
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

/**
 * Plain-text truncation with a trailing ellipsis. Unlike pi-tui's
 * truncateToWidth it never emits reset sequences, so coloring the result
 * afterwards cannot leak the terminal's default foreground mid-row.
 */
export function clip(text: string, width: number): string {
  const safe = Math.max(0, Math.floor(width));
  if (safe === 0) return "";
  if (visibleWidth(text) <= safe) return text;
  if (safe === 1) return "…";
  let cells = 0;
  let out = "";
  for (const char of text) {
    const cellWidth = visibleWidth(char);
    if (cells + cellWidth > safe - 1) break;
    out += char;
    cells += cellWidth;
  }
  return `${out}…`;
}

/**
 * Strips OSC, CSI, and control sequences from pasted prompt text at the
 * collection boundary. The rail is a display: raw escapes from pasted
 * terminal output would otherwise repaint cells, retitle the window, or
 * split mid-sequence inside width math.
 */
export function stripControl(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " ");
}

/**
 * A smooth meter in eighths of a cell: whole cells, one partial glyph, then a
 * dim track of the same shape. `fill` and `track` are complete SGR prefixes.
 */
const EIGHTHS = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];

export function meterCells(
  ratio: number | null,
  cells: number,
  fill: string,
  track: string,
  trackGlyph = "█",
  shimmer: number | null = null,
): string {
  if (ratio === null || !Number.isFinite(ratio) || cells <= 0) return "";
  const clamped = Math.max(0, Math.min(1, ratio));
  const exact = clamped * cells;
  let whole = Math.floor(exact);
  let partial = Math.round((exact - whole) * 8);
  if (partial === 8) {
    whole += 1;
    partial = 0;
  }
  const partialGlyph = partial > 0 ? EIGHTHS[partial - 1] : "";
  const trackCells = Math.max(0, cells - whole - (partialGlyph ? 1 : 0));
  // While a meter eases, one filled cell wears bold: a shimmer riding the fill.
  const block = (index: number) => (shimmer !== null && index === shimmer ? `${fill}\x1b[1m█${RST}${fill}` : "█");
  let filledPart = "";
  for (let index = 0; index < whole; index++) filledPart += block(index);
  filledPart += partialGlyph;
  return `${fill}${filledPart}${RST}${track}${trackGlyph.repeat(trackCells)}${RST}`;
}

/** Compact counts: 940, 1.4k, 12k, 1.2M. */
export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "?";
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatCost(cost: number): string {
  if (!Number.isFinite(cost)) return "$?";
  if (cost >= 1000) return `$${(cost / 1000).toFixed(2)}k`;
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
  return `…${clip(parts.at(-1) ?? path, Math.max(0, width - 1))}`;
}

