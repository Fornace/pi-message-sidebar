import assert from "node:assert/strict";
import test from "node:test";
import { ARRIVE_MS, SHEEN_CYCLE_MS, arriveProgress, isArriving, sheenBand } from "../src/anim.ts";
import { flagRow } from "../src/flag.ts";
import { FORNACE_FLAG_256, resolvePalette } from "../src/palette.ts";
import { meterCells } from "../src/style.ts";

test("the flag crown paints the seven brand hues in order across the rail", () => {
  const palette = resolvePalette(null);
  const row = flagRow(palette, 41, 0, false);
  for (const [index, code] of FORNACE_FLAG_256.entries()) {
    assert.ok(row.includes(`\x1b[48;5;${code}m`), `brand hue ${index} must appear`);
  }
  // Boundary plus 41 cells: the crown spans the full rail width.
  assert.equal(row.replace(/\x1b\[[0-9;]*m/g, "").length, 42);
});

test("the sheen band crosses the flag only while the rail is live", () => {
  assert.equal(sheenBand(0, 41), -1, "the band starts off-flag");
  const mid = Math.floor(SHEEN_CYCLE_MS / 2);
  assert.ok(sheenBand(mid, 41) >= 0, "mid-cycle the band rides the flag");
  const live = flagRow(resolvePalette(null), 41, mid, true);
  const idle = flagRow(resolvePalette(null), 41, mid, false);
  assert.notEqual(live, idle, "a live rail brightens the band");
});

test("arrival reveals left to right and settles", () => {
  assert.equal(arriveProgress(1000, 0), 1, "old slots are fully revealed");
  const half = arriveProgress(ARRIVE_MS / 2, 0);
  assert.ok(half > 0.4 && half < 0.6, `halfway through the reveal (${half})`);
  assert.ok(isArriving(ARRIVE_MS - 1, 0) && !isArriving(ARRIVE_MS, 0));
});

test("a shimmer cell rides the fill while a meter eases", () => {
  const plain = meterCells(0.5, 10, "\x1b[38;5;75m", "\x1b[38;5;238m", "─");
  const lit = meterCells(0.5, 10, "\x1b[38;5;75m", "\x1b[38;5;238m", "─", 2);
  assert.ok(!plain.includes("\x1b[1m"), "an idle meter has no shimmer");
  assert.ok(lit.includes("\x1b[1m"), "an easing meter brightens one cell");
});
