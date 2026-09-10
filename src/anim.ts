/**
 * Animation timing for the rail, in the spirit of pi-recap: an 80-90 ms tick
 * runs only while something is actually moving, and idle costs nothing.
 */

/** One sine cycle of the pulsing pending dot. */
export const DOT_CYCLE_MS = 900;
/** Color sweep after a summary lands: accent, bold accent, then rest. */
export const SETTLE_MS = 360;
/** Tick cadence while any animation is live. */
export const ANIM_TICK_MS = 90;
export const DOT_GLYPH = "●";

/** Cosine pulse 0..1, starting at the trough so a dot fades up, not blinks on. */
export function pulse(now: number, startedAt: number, cycleMs = DOT_CYCLE_MS): number {
  const phase = ((now - startedAt) % cycleMs) / cycleMs;
  return 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
}

/** 0 = settled, 1 = accent flash, 2 = bold accent. */
export function settlePhase(now: number, landedAt: number): 0 | 1 | 2 {
  const elapsed = now - landedAt;
  if (elapsed >= SETTLE_MS) return 0;
  return elapsed < SETTLE_MS / 2 ? 1 : 2;
}

export function isSettling(now: number, landedAt: number): boolean {
  return now - landedAt < SETTLE_MS;
}
