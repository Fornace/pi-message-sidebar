import type { Theme } from "@earendil-works/pi-coding-agent";

export type RGB = readonly [number, number, number];

export function parseHex(hex: string): RGB | null {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : "";
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function fgRgb(rgb: RGB): string {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

export function bgRgb(rgb: RGB): string {
  return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

export function rgbLerp(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/** Mix `over` onto `under` at alpha, for accent tints on the rail canvas. */
export function blend(under: RGB, over: RGB, alpha: number): RGB {
  return rgbLerp(under, over, Math.max(0, Math.min(1, alpha)));
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
 * The obsidian rail palette: one deep well for content, one raised panel for
 * the goal card, and two ghost tiers for chrome that should be found, not
 * seen. Truecolor when the theme reports it, a 256-color ladder otherwise,
 * and a light-terminal variant throughout.
 */
export type Palette = {
  /** The rail canvas: the deepest step, where content floats. */
  bgDeep: string;
  /** The raised card step: goal block and the hint strip. */
  bgPanel: string;
  /** Soft accent tint for a focused selection. */
  bgSelect: string;
  /** Half-strength tint: unfocused selection and landing glow. */
  bgSelectSoft: string;
  /** The left boundary hairline, nearly invisible. */
  edge: string;
  /** Ghost header labels. */
  ghost: string;
  /** Ghost header metadata and actionable hints. */
  ghostBright: string;
  textNew: string;
  textMid: string;
  textOld: string;
  preview: string;
  accent: string;
  badgeAdded: string;
  badgeModified: string;
  badgeDeleted: string;
  badgeRenamed: string;
  /** Truecolor endpoints for breathing and pulsing dots. */
  dotDim: RGB | null;
  dotPeak: RGB | null;
  dotFallback: string[];
  /** Truecolor glow endpoints, null off truecolor. */
  glowFrom: RGB | null;
  glowTo: RGB | null;
  bold: (text: string) => string;
  truecolor: boolean;
};

const DARK = {
  deep: [12, 13, 20] as RGB,
  panel: [20, 22, 34] as RGB,
  edge: [34, 37, 55] as RGB,
  ghost: [56, 60, 84] as RGB,
  ghostBright: [86, 91, 122] as RGB,
  textNew: [232, 233, 240] as RGB,
  textMid: [176, 180, 196] as RGB,
  textOld: [110, 114, 134] as RGB,
  preview: [88, 92, 112] as RGB,
};

const LIGHT = {
  deep: [238, 240, 246] as RGB,
  panel: [226, 229, 239] as RGB,
  edge: [204, 208, 222] as RGB,
  ghost: [152, 157, 178] as RGB,
  ghostBright: [118, 123, 148] as RGB,
  textNew: [24, 26, 36] as RGB,
  textMid: [62, 66, 84] as RGB,
  textOld: [112, 116, 136] as RGB,
  preview: [140, 144, 164] as RGB,
};

const FALLBACK_256 = {
  bgDeep: "\x1b[48;5;233m",
  bgPanel: "\x1b[48;5;235m",
  bgSelect: "\x1b[48;5;238m",
  bgSelectSoft: "\x1b[48;5;236m",
  edge: "\x1b[38;5;238m",
  ghost: "\x1b[38;5;240m",
  ghostBright: "\x1b[38;5;244m",
  textNew: "\x1b[38;5;255m",
  textMid: "\x1b[38;5;250m",
  textOld: "\x1b[38;5;244m",
  preview: "\x1b[38;5;240m",
  accent: "\x1b[38;5;75m",
  badgeAdded: "\x1b[38;5;150m",
  badgeModified: "\x1b[38;5;221m",
  badgeDeleted: "\x1b[38;5;203m",
  badgeRenamed: "\x1b[38;5;117m",
};

const LIGHT_256 = {
  bgDeep: "\x1b[48;5;254m",
  bgPanel: "\x1b[48;5;251m",
  bgSelect: "\x1b[48;5;249m",
  bgSelectSoft: "\x1b[48;5;252m",
  edge: "\x1b[38;5;249m",
  ghost: "\x1b[38;5;244m",
  ghostBright: "\x1b[38;5;240m",
};

/**
 * The Fornace mark sampled from the production logo asset: seven hues in
 * rainbow order, painted as a solid band. Truecolor carries the exact brand
 * values; the 256 ladder keeps the hue order readable on older terminals.
 */
export const FORNACE_FLAG: RGB[] = [
  [224, 48, 64],
  [240, 144, 32],
  [240, 208, 96],
  [176, 208, 48],
  [16, 128, 176],
  [80, 64, 144],
  [160, 32, 144],
];

export const FORNACE_FLAG_256 = [167, 208, 221, 148, 31, 61, 127];

/**
 * Universal content colors, theme-agnostic like pi-recap's: a theme's `text`
 * token can be a saturated hue that clashes with a dense rail, so content
 * text keeps a neutral ladder while decorative elements stay on tokens.
 */
function universal(rgb: RGB): string {
  return fgRgb(rgb);
}

export function resolvePalette(theme: Theme | null): Palette {
  const light = isLightBg();
  const steps = light ? LIGHT : DARK;

  if (!theme) {
    const f = light ? { ...FALLBACK_256, ...LIGHT_256 } : FALLBACK_256;
    return {
      bgDeep: f.bgDeep,
      bgPanel: f.bgPanel,
      bgSelect: f.bgSelect,
      bgSelectSoft: f.bgSelectSoft,
      edge: f.edge,
      ghost: f.ghost,
      ghostBright: f.ghostBright,
      textNew: universal(steps.textNew),
      textMid: universal(steps.textMid),
      textOld: universal(steps.textOld),
      preview: universal(steps.preview),
      accent: f.accent,
      badgeAdded: f.badgeAdded,
      badgeModified: f.badgeModified,
      badgeDeleted: f.badgeDeleted,
      badgeRenamed: f.badgeRenamed,
      dotDim: null,
      dotPeak: null,
      dotFallback: [f.ghost, f.ghostBright, f.accent],
      glowFrom: null,
      glowTo: null,
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
  const accentAnsi = fg("accent", FALLBACK_256.accent);
  const dimAnsi = fg("dim", FALLBACK_256.ghost);
  const truecolor = theme.getColorMode() === "truecolor";
  const accentRgb = truecolor ? parseTruecolor(accentAnsi) : null;

  const select = accentRgb
    ? bgRgb(blend(steps.deep, accentRgb, 0.16))
    : (light ? LIGHT_256 : FALLBACK_256).bgSelect;
  const selectSoft = accentRgb
    ? bgRgb(blend(steps.deep, accentRgb, 0.08))
    : (light ? LIGHT_256 : FALLBACK_256).bgSelectSoft;

  return {
    bgDeep: truecolor ? bgRgb(steps.deep) : (light ? LIGHT_256 : FALLBACK_256).bgDeep,
    bgPanel: truecolor ? bgRgb(steps.panel) : (light ? LIGHT_256 : FALLBACK_256).bgPanel,
    bgSelect: select,
    bgSelectSoft: selectSoft,
    edge: truecolor ? fgRgb(steps.edge) : (light ? LIGHT_256 : FALLBACK_256).edge,
    ghost: truecolor ? fgRgb(steps.ghost) : (light ? LIGHT_256 : FALLBACK_256).ghost,
    ghostBright: truecolor ? fgRgb(steps.ghostBright) : (light ? LIGHT_256 : FALLBACK_256).ghostBright,
    textNew: universal(steps.textNew),
    textMid: universal(steps.textMid),
    textOld: universal(steps.textOld),
    preview: universal(steps.preview),
    accent: accentAnsi,
    badgeAdded: fg("toolDiffAdded", FALLBACK_256.badgeAdded),
    badgeModified: fg("warning", FALLBACK_256.badgeModified),
    badgeDeleted: fg("toolDiffRemoved", FALLBACK_256.badgeDeleted),
    badgeRenamed: fg("borderAccent", FALLBACK_256.badgeRenamed),
    dotDim: truecolor ? parseTruecolor(dimAnsi) : null,
    dotPeak: accentRgb ?? (truecolor ? parseHex("#cba6f7") : null),
    dotFallback: [dimAnsi, fg("muted", FALLBACK_256.ghostBright), accentAnsi],
    glowFrom: accentRgb ? blend(steps.deep, accentRgb, 0.10) : null,
    glowTo: steps.deep,
    bold: (text) => theme.bold(text),
    truecolor,
  };
}
