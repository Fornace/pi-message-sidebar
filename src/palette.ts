import type { Theme } from "@earendil-works/pi-coding-agent";

export type RGB = readonly [number, number, number];

export function parseHex(hex: string): RGB | null {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function fgRgb(rgb: RGB): string {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

export function rgbLerp(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/** Light vs dark terminal background, via COLORFGBG like pi-recap. */
export function isLightBg(): boolean {
  const fgbg = process.env.COLORFGBG;
  if (fgbg) {
    const bg = parseInt(fgbg.split(";").at(-1) ?? "0", 10);
    if (!Number.isNaN(bg)) return bg >= 8;
  }
  return false;
}

function parseTruecolor(ansi: string): RGB | null {
  const match = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * One resolved palette per render: theme tokens for semantic colors, a
 * three-step background ladder for structure, and truecolor endpoints for
 * the pulsing dot. A null theme (tests, headless) falls back to 256 colors.
 */
export type Palette = {
  bgBase: string;
  bgRaised: string;
  bgSunken: string;
  bgSelected: string;
  rule: string;
  label: string;
  meta: string;
  textNew: string;
  textMid: string;
  textOld: string;
  preview: string;
  accent: string;
  surface: string;
  badgeAdded: string;
  badgeModified: string;
  badgeDeleted: string;
  badgeRenamed: string;
  dotDim: RGB | null;
  dotPeak: RGB | null;
  dotFallback: string[];
  bold: (text: string) => string;
  truecolor: boolean;
};

const FALLBACK = {
  rule: "\x1b[38;5;240m",
  label: "\x1b[38;5;246m",
  meta: "\x1b[38;5;240m",
  textNew: "\x1b[38;5;255m",
  textMid: "\x1b[38;5;252m",
  textOld: "\x1b[38;5;246m",
  preview: "\x1b[38;5;243m",
  accent: "\x1b[38;5;75m",
  surface: "\x1b[38;5;80m",
  badgeAdded: "\x1b[38;5;150m",
  badgeModified: "\x1b[38;5;221m",
  badgeDeleted: "\x1b[38;5;203m",
  badgeRenamed: "\x1b[38;5;117m",
};

/**
 * Universal content colors, theme-agnostic like pi-recap's: a theme's `text`
 * token can be a saturated hue that clashes with a dense rail, so content
 * text keeps a neutral ladder while decorative elements stay on tokens.
 */
function universal(dark: RGB, light: RGB): string {
  return fgRgb(isLightBg() ? light : dark);
}

export function resolvePalette(theme: Theme | null): Palette {
  const light = isLightBg();
  const ladder = light
    ? { base: "\x1b[48;5;252m", raised: "\x1b[48;5;249m", sunken: "\x1b[48;5;254m" }
    : { base: "\x1b[48;5;234m", raised: "\x1b[48;5;235m", sunken: "\x1b[48;5;233m" };
  const content = {
    newest: universal([232, 232, 232], [26, 26, 26]),
    mid: universal([208, 208, 208], [60, 60, 60]),
    meta: universal([88, 88, 88], [150, 150, 150]),
  };

  if (!theme) {
    return {
      bgBase: ladder.base,
      bgRaised: ladder.raised,
      bgSunken: ladder.sunken,
      bgSelected: light ? "\x1b[48;5;250m" : "\x1b[48;5;238m",
      rule: FALLBACK.rule,
      label: FALLBACK.label,
      meta: content.meta,
      textNew: content.newest,
      textMid: content.mid,
      textOld: FALLBACK.textOld,
      preview: FALLBACK.preview,
      accent: FALLBACK.accent,
      surface: FALLBACK.surface,
      badgeAdded: FALLBACK.badgeAdded,
      badgeModified: FALLBACK.badgeModified,
      badgeDeleted: FALLBACK.badgeDeleted,
      badgeRenamed: FALLBACK.badgeRenamed,
      dotDim: null,
      dotPeak: null,
      dotFallback: [FALLBACK.meta, FALLBACK.label, FALLBACK.accent],
      bold: (text) => `\x1b[1m${text}`,
      truecolor: false,
    };
  }

  const fg = (token: Parameters<Theme["getFgAnsi"]>[0], fallback: string) => {
    try {
      return theme.getFgAnsi(token);
    } catch {
      return fallback;
    }
  };
  const accentAnsi = fg("accent", FALLBACK.accent);
  const dimAnsi = fg("dim", FALLBACK.meta);
  const truecolor = theme.getColorMode() === "truecolor";

  return {
    bgBase: ladder.base,
    bgRaised: ladder.raised,
    bgSunken: ladder.sunken,
    bgSelected: theme.getBgAnsi("selectedBg"),
    rule: fg("borderMuted", FALLBACK.rule),
    label: fg("muted", FALLBACK.label),
    meta: content.meta,
    textNew: content.newest,
    textMid: content.mid,
    textOld: fg("muted", FALLBACK.textOld),
    preview: fg("dim", FALLBACK.preview),
    accent: accentAnsi,
    surface: fg("borderAccent", FALLBACK.surface),
    badgeAdded: fg("toolDiffAdded", FALLBACK.badgeAdded),
    badgeModified: fg("warning", FALLBACK.badgeModified),
    badgeDeleted: fg("toolDiffRemoved", FALLBACK.badgeDeleted),
    badgeRenamed: fg("borderAccent", FALLBACK.badgeRenamed),
    dotDim: truecolor ? parseTruecolor(dimAnsi) : null,
    dotPeak: truecolor ? (parseTruecolor(accentAnsi) ?? parseHex("#cba6f7")) : null,
    dotFallback: [dimAnsi, fg("muted", FALLBACK.label), accentAnsi],
    bold: (text) => theme.bold(text),
    truecolor,
  };
}
