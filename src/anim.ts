/**
 * Animation timing for the rail, in the spirit of pi-recap: an 80-90 ms tick
 * runs only while something is actually moving, and idle costs nothing.
 * Two cadences carry the whole rail: a fast pulse for live work and a slow
 * breath for ambient state, so motion reads as one language.
 */

/** One sine cycle of the pulsing pending dot. */
export const DOT_CYCLE_MS = 900;
/** Ambient cycle of the goal status dot: present, not urgent. */
export const BREATHE_CYCLE_MS = 2400;
/** Color sweep after a summary lands: accent, bold accent, then rest. */
export const SETTLE_MS = 360;
/** How long a fresh message keeps its soft landing glow. */
export const GLOW_MS = 2200;
/** Left-to-right reveal of a message slot as it arrives. */
export const ARRIVE_MS = 350;
/** One sheen band crossing the flag while the rail is live. */
export const SHEEN_CYCLE_MS = 2800;
/** The goal-complete flash on the card title. */
export const VICTORY_MS = 700;
/** Tick cadence while any animation is live. */
export const ANIM_TICK_MS = 90;
/** Per-tick share of the gap a meter closes while easing toward its target. */
export const METER_EASE = 0.35;
/** Meters closer than this to their target are considered settled. */
export const METER_EPSILON = 0.004;
export const DOT_GLYPH = "●";

/** Cosine pulse 0..1, starting at the trough so a dot fades up, not blinks on. */
export function pulse(now: number, startedAt: number, cycleMs = DOT_CYCLE_MS): number {
  const phase = ((now - startedAt) % cycleMs) / cycleMs;
  return 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
}

/** The ambient breath: same cosine, slower cycle. */
export function breathe(now: number): number {
  return pulse(now, 0, BREATHE_CYCLE_MS);
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

/** 1 right after a message lands, decaying to 0 over GLOW_MS. */
export function glowStrength(now: number, landedAt: number): number {
  const elapsed = now - landedAt;
  if (elapsed >= GLOW_MS) return 0;
  return 1 - elapsed / GLOW_MS;
}

/** 0..1 left-to-right reveal progress for a slot that arrived at `arrivedAt`. */
export function arriveProgress(now: number, arrivedAt: number): number {
  const elapsed = now - arrivedAt;
  if (elapsed >= ARRIVE_MS) return 1;
  return Math.max(0, elapsed / ARRIVE_MS);
}

export function isArriving(now: number, arrivedAt: number): boolean {
  return now - arrivedAt < ARRIVE_MS;
}

/** Index of the sheen band crossing `cells` flag cells, or -1 between sweeps. */
export function sheenBand(now: number, cells: number): number {
  const phase = (now % SHEEN_CYCLE_MS) / SHEEN_CYCLE_MS;
  const position = Math.floor(phase * (cells + 4)) - 2;
  return position >= 0 && position < cells ? position : -1;
}

/** True while the goal-complete flash is still on the card. */
export function isVictory(now: number, completedAt: number): boolean {
  return now - completedAt < VICTORY_MS;
}

/**
 * A meter value that eases toward its target instead of snapping, so a jump
 * in context pressure or budget spend reads as motion. Tick returns true
 * while the value is still moving, which is what keeps the animation tick
 * alive; a settled meter costs nothing.
 */
export class EasedMeter {
  private value: number | null = null;

  set(target: number | null): void {
    if (target === null || !Number.isFinite(target)) {
      this.value = null;
      return;
    }
    if (this.value === null) this.value = target;
  }

  get(): number | null {
    return this.value;
  }

  target(target: number | null): number | null {
    return target === null || !Number.isFinite(target) ? null : Math.max(0, Math.min(1, target));
  }

  /** True while a tick would still move the value toward `target`. */
  moving(target: number | null): boolean {
    const clamped = this.target(target);
    if (clamped === null) return this.value !== null;
    if (this.value === null) return false;
    return Math.abs(clamped - this.value) >= METER_EPSILON;
  }

  /** Advance one tick; true while still converging toward `target`. */
  tick(target: number | null): boolean {
    const clamped = this.target(target);
    if (clamped === null) {
      this.value = null;
      return false;
    }
    if (this.value === null) {
      this.value = clamped;
      return false;
    }
    const gap = clamped - this.value;
    if (Math.abs(gap) < METER_EPSILON) {
      this.value = clamped;
      return false;
    }
    this.value += gap * METER_EASE;
    return true;
  }
}
