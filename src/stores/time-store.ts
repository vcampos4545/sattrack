/**
 * Simulation clock. The single source of "now" for every orbital calculation.
 *
 * Simulation time is a linear function of wall-clock time:
 *   sim(t) = anchorSimMs + (t - anchorRealMs) * rate      (running)
 *   sim(t) = anchorSimMs                                  (paused)
 * Every control (pause, rate change, jump) re-anchors at the current instant
 * so simulation time stays continuous.
 *
 * Rules for consumers:
 * - Orbit code never calls Date.now(). Call `getSimTimeMs()` (outside React)
 *   or `useSimTimeMs(hz)` (in components) and pass the value down.
 * - The store state changes only when the clock is controlled, not on every
 *   tick, so subscribing to it does not cause per-frame re-renders.
 */
import { create } from 'zustand';

/** Wall clock. Replaceable in tests via `setWallClock`. */
let wallClock: () => number = () => Date.now();

export function setWallClock(fn: () => number): void {
  wallClock = fn;
}

/**
 * Real (wall-clock) time, UTC ms. For display only, e.g. showing how far the
 * simulation is from real time. Orbit calculations use `getSimTimeMs()`.
 */
export function getWallClockMs(): number {
  return wallClock();
}

export interface TimeState {
  anchorRealMs: number;
  anchorSimMs: number;
  /** Simulation seconds per wall-clock second. Negative runs backward. */
  rate: number;
  paused: boolean;
  /** Current simulation time, UTC ms. */
  now(): number;
  /** True when running at 1x and within 1 s of the wall clock. */
  isLive(): boolean;
  pause(): void;
  resume(): void;
  setRate(rate: number): void;
  /** Jump to an absolute UTC instant (ms). Keeps the paused/running state. */
  jumpTo(simMs: number): void;
  /** Shift simulation time by `deltaMs` (may be negative). */
  step(deltaMs: number): void;
  /** Back to real time: now = wall clock, rate 1, running. */
  resetToLive(): void;
}

export const MAX_ABS_RATE = 100_000;

export const useTimeStore = create<TimeState>()((set, get) => {
  const simAt = (realMs: number) => {
    const s = get();
    return s.paused ? s.anchorSimMs : s.anchorSimMs + (realMs - s.anchorRealMs) * s.rate;
  };
  const reanchor = (patch: Partial<Pick<TimeState, 'anchorSimMs' | 'rate' | 'paused'>> = {}) => {
    const real = wallClock();
    set({ anchorRealMs: real, anchorSimMs: simAt(real), ...patch });
  };
  const start = wallClock();
  return {
    anchorRealMs: start,
    anchorSimMs: start,
    rate: 1,
    paused: false,
    now: () => simAt(wallClock()),
    isLive: () => {
      const s = get();
      return !s.paused && s.rate === 1 && Math.abs(simAt(wallClock()) - wallClock()) < 1000;
    },
    pause: () => {
      if (!get().paused) reanchor({ paused: true });
    },
    resume: () => {
      if (get().paused) reanchor({ paused: false });
    },
    setRate: (rate) => {
      if (!Number.isFinite(rate)) return;
      reanchor({ rate: Math.max(-MAX_ABS_RATE, Math.min(MAX_ABS_RATE, rate)) });
    },
    jumpTo: (simMs) => {
      if (!Number.isFinite(simMs)) return;
      reanchor({ anchorSimMs: simMs });
    },
    step: (deltaMs) => {
      const real = wallClock();
      set({ anchorRealMs: real, anchorSimMs: simAt(real) + deltaMs });
    },
    resetToLive: () => {
      const real = wallClock();
      set({ anchorRealMs: real, anchorSimMs: real, rate: 1, paused: false });
    },
  };
});

/** Current simulation time (UTC ms) for non-React code. */
export function getSimTimeMs(): number {
  return useTimeStore.getState().now();
}
