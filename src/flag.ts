import { sheenBand } from "./anim.ts";
import { FORNACE_FLAG, FORNACE_FLAG_256, type Palette, type RGB, bgRgb, blend } from "./palette.ts";
import { RST } from "./style.ts";

/**
 * The Fornace flag: the rail's crown row, a solid rainbow of the seven brand
 * hues sampled from the production logo. While the rail is live a two-cell
 * sheen band crosses it, so the mark breathes with the session and rests
 * when the session rests.
 */
export function flagRow(palette: Palette, cells: number, now: number, live: boolean): string {
  const band = live ? sheenBand(now, cells) : -1;
  const lit = (index: number) => band >= 0 && (index === band || index === band + 1);
  const parts: string[] = [palette.edge, "│", RST];
  for (let index = 0; index < cells; index++) {
    const hue = index % FORNACE_FLAG.length;
    let cell: string;
    if (palette.truecolor) {
      const rgb: RGB = FORNACE_FLAG[hue]!;
      cell = bgRgb(lit(index) ? blend(rgb, [255, 255, 255], 0.45) : rgb);
    } else {
      cell = `\x1b[48;5;${FORNACE_FLAG_256[hue]}m`;
      if (lit(index)) cell = `\x1b[1m${cell}`;
    }
    parts.push(cell, " ");
  }
  parts.push(RST);
  return parts.join("");
}
