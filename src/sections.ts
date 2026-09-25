import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CmuxContext } from "./cmux.ts";
import type { FileEdit } from "./files.ts";
import type { Palette } from "./palette.ts";
import { computeUsage } from "./status-dock.ts";
import { RST, clip, ellipsizePath, formatCost, formatCwd, meterCells } from "./style.ts";

/**
 * Content width inside the rail: 42 columns minus the boundary and the two
 * pads. Every budget below measures against this, so a right-aligned element
 * lands one pad short of the rail edge.
 */
export const RAIL_CONTENT = 39;

/** Cells a rail row paints to the right of the boundary: pad + content + pad. */
export function railFill(width = RAIL_CONTENT): number {
  return width + 2;
}

export function railRow(palette: Palette, content: string, bg: string, width = RAIL_CONTENT): string {
  const injected = content.replace(/\x1b\[0m/g, `${RST}${bg}`);
  const pad = " ".repeat(Math.max(0, width + 1 - visibleWidth(injected)));
  return `${palette.edge}│${RST}${bg} ${injected}${pad}${RST}`;
}

/**
 * A ghost header: a quiet label flush with the content edge, metadata in the
 * brighter ghost tier on the right. No rules, no dashes, no indent: sections
 * separate by air and background steps, and chrome stays below content.
 */
export function ghostHeader(palette: Palette, label: string, bg: string, right = "", width = RAIL_CONTENT): string {
  const rightCells = right ? visibleWidth(right) + 1 : 0;
  const budget = Math.max(0, width - visibleWidth(label) - rightCells);
  const content = [
    palette.ghost, label,
    " ".repeat(budget),
    ...(right ? [palette.ghostBright, right] : []),
  ].join("");
  return railRow(palette, content, bg, width);
}

/** Meter color by pressure: accent, warning at 70 percent, danger at 90. */
export function pressureColor(palette: Palette, ratio: number | null, override?: string): string {
  if (override) return override;
  if (ratio === null || !Number.isFinite(ratio)) return palette.accent;
  if (ratio >= 0.9) return palette.badgeDeleted;
  if (ratio >= 0.7) return palette.badgeModified;
  return palette.accent;
}

export function meterTrack(palette: Palette): string {
  return palette.edge;
}

// --- session and files ------------------------------------------------------

function fileBadge(palette: Palette, letter: string | null): string {
  switch (letter) {
    case "M": return `${palette.badgeModified}M${RST}`;
    case "A": return `${palette.badgeAdded}A${RST}`;
    case "U": return `${palette.badgeAdded}U${RST}`;
    case "D": return `${palette.badgeDeleted}D${RST}`;
    case "R": return `${palette.badgeRenamed}R${RST}`;
    default: return `${palette.ghost}·${RST}`;
  }
}

/** The FILES window the component resolved: pure display data. */
export type FileWindow = {
  /** First file index rendered. */
  start: number;
  /** One past the last file index rendered. */
  end: number;
  /** Selected file index while the rail is in files mode, else null. */
  cursor: number | null;
  /** Files hidden above and below the window. */
  hiddenAbove: number;
  hiddenBelow: number;
};

/**
 * Session identity plus the write footprint in one quiet block: a blank
 * separator row, a ghost header carrying the branch, the surface and
 * workspace, the cwd, then an optional session id row and a FILES subsection
 * whose rows carry the git letter convention in front of front-trimmed paths.
 * The identity leads with the stable role id when one is bound; the dynamic
 * surface ref is only the fallback, because refs renumber on every crash.
 */
export function renderSessionSection(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider | null,
  cmux: CmuxContext | null,
  rows: number,
  palette: Palette,
  files: FileEdit[],
  statusFor: (path: string) => string | null,
  fileWindow: FileWindow | null = null,
  width = RAIL_CONTENT,
): string[] {
  if (rows <= 0) return [];
  const lines: string[] = [];
  const push = (line: string) => { if (lines.length < rows) lines.push(line); };
  const bg = palette.bgDeep;

  push(railRow(palette, "", bg, width));
  const branch = footerData?.getGitBranch() ?? null;
  push(ghostHeader(palette, "SESSION", bg, branch ? clip(branch, width - 12) : "", width));

  const surface = cmux?.roleId ?? cmux?.surfaceRef ?? "surface n/a";
  const workspace = cmux?.workspaceTitle ?? cmux?.workspaceRef ?? "";
  // A stable role id gets more room than a ref: it is the identity line.
  const identityBudget = cmux?.roleId ? 16 : 12;
  const identityRow = workspace
    ? `${palette.accent}${clip(surface, identityBudget)}${RST} ${palette.ghost}·${RST} ${palette.textMid}${clip(workspace, Math.max(1, width - identityBudget - 4))}${RST}`
    : `${palette.accent}${clip(surface, width)}${RST}`;
  push(railRow(palette, identityRow, bg, width));
  push(railRow(palette, `${palette.textMid}${ellipsizePath(formatCwd(ctx.sessionManager.getCwd()), width)}${RST}`, bg, width));
  if (rows >= 5) {
    const sessionId = ctx.sessionManager.getSessionId().replace(/-/g, "").slice(0, 8);
    push(railRow(palette, `${palette.badgeRenamed}session${RST} ${palette.textMid}${sessionId}${RST}`, bg, width));
  }
  // The FILES subsection needs its air, header, plus at least one file row.
  if (files.length > 0 && rows - lines.length >= 3) {
    const noun = files.length === 1 ? "file" : "files";
    const window = fileWindow ?? { start: 0, end: files.length, cursor: null, hiddenAbove: 0, hiddenBelow: 0 };
    const right = window.cursor !== null
      ? `${window.cursor + 1}/${files.length} ${noun}`
      : `${files.length} ${noun}`;
    push(railRow(palette, "", bg, width));
    push(ghostHeader(palette, "FILES", bg, right, width));
    if (window.hiddenAbove > 0) {
      push(railRow(palette, `${palette.ghost}… ${window.hiddenAbove} above${RST}`, bg, width));
    }
    for (let index = window.start; index < window.end; index++) {
      if (lines.length >= rows) break;
      const file = files[index]!;
      const badge = fileBadge(palette, statusFor(file.path));
      const repeats = file.edits > 1 ? `${palette.ghost} ×${file.edits}${RST}` : "";
      const marker = index === window.cursor ? `${palette.accent}▸${RST}` : " ";
      const pathBudget = width - 3 - visibleWidth(repeats);
      push(railRow(palette, `${marker}${badge} ${palette.textMid}${ellipsizePath(file.path, Math.max(1, pathBudget))}${RST}${repeats}`, bg, width));
    }
    if (window.hiddenBelow > 0 && lines.length < rows) {
      push(railRow(palette, `${palette.ghost}… ${window.hiddenBelow} more${RST}`, bg, width));
    }
  }
  while (lines.length < rows) push(railRow(palette, "", bg, width));
  return lines;
}

// --- runtime ----------------------------------------------------------------

/**
 * The runtime block: ghost header with the thinking level, the model route,
 * and a context meter whose fill eases toward the live reading.
 */
export function renderRuntimeSection(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider | null,
  thinkingLevel: string,
  rows: number,
  palette: Palette,
  width = RAIL_CONTENT,
  contextRatio: number | null = null,
  shimmer: number | null = null,
): string[] {
  if (rows <= 0) return [];
  const lines: string[] = [];
  const push = (line: string) => { if (lines.length < rows) lines.push(line); };
  const bg = palette.bgDeep;

  push(railRow(palette, "", bg, width));
  const model = ctx.model;
  const thinkingRight = model?.reasoning ? clip(thinkingLevel, width - 12) : "";
  push(ghostHeader(palette, "RUNTIME", bg, thinkingRight, width));
  if (model) {
    const provider = footerData && footerData.getAvailableProviderCount() > 1 ? `${model.provider}/` : "";
    push(railRow(palette, `${palette.textMid}${clip(`${provider}${model.id}`, width)}${RST}`, bg, width));
  }
  const usage = computeUsage(ctx);
  const percent = usage.contextPercent === null ? null : Math.round(usage.contextPercent);
  const ratio = contextRatio ?? (percent === null ? null : percent / 100);
  const meter = meterCells(ratio, 10, pressureColor(palette, ratio), meterTrack(palette), "─", shimmer);
  const percentText = percent === null ? "?" : `${percent}%`;
  const meterText = meter
    ? `${palette.ghost}ctx${RST} ${meter} ${palette.textMid}${percentText}${RST}`
    : `${palette.ghost}ctx${RST} ${palette.textMid}${percentText}${RST}`;
  push(railRow(palette, `${meterText} ${palette.ghost}·${RST} ${palette.textMid}${formatCost(usage.cost)}${RST}`, bg, width));
  while (lines.length < rows) push(railRow(palette, "", bg, width));
  return lines;
}
