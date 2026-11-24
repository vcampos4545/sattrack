/**
 * Bulk orbit-path sampling for drawing many orbits at once.
 *
 * `sampleTrajectory` (satellite-propagator.ts) returns full `SatelliteState`
 * objects, including the iterative geodetic conversion, which is what the
 * ground track and single-object views need. Drawing hundreds or thousands of
 * orbit paths only needs TEME positions, so this samples SGP4 directly into
 * one packed Float32Array that can go straight into a GPU buffer (or across a
 * Web Worker boundary without copying).
 *
 * Every path is real SGP4 output at each sample time; nothing is fitted or
 * approximated. Units: km, TEME. Times: UTC ms.
 */
import type { SatRec } from 'satellite.js';
import { orbitalPeriodMin } from './satellite-propagator';
import { propagateToTime } from './sgp4';

export interface OrbitWindow {
  /** Instant the window is placed around (simulation time), UTC ms. */
  centerMs: number;
  /** Path length in orbital periods of each object. */
  periods: number;
  /** Fraction of the window before `centerMs` (0 = all future, 0.5 = centered). */
  trailFraction: number;
}

/** Start/end (UTC ms) of the window for an object with the given period. */
export function orbitWindowBounds(periodMin: number, w: OrbitWindow): { startMs: number; endMs: number } {
  const spanMs = periodMin * 60_000 * w.periods;
  const startMs = w.centerMs - spanMs * w.trailFraction;
  return { startMs, endMs: startMs + spanMs };
}

export interface PackedOrbits {
  /** TEME positions, km, all paths concatenated: [x, y, z, x, y, z, ...]. */
  positionsKm: Float32Array;
  /** Number of points in path i. A path may have 0 points if SGP4 failed throughout. */
  counts: Uint32Array;
}

/**
 * Samples each orbit over its window with `samplesPerPeriod` points per
 * orbital period (at least `minSamples` per path). A failed SGP4 sample ends
 * that path at the last good point, so a decaying object never draws a line
 * through a missing stretch.
 */
export function sampleOrbitsPacked(
  satrecs: readonly (SatRec | null)[],
  w: OrbitWindow,
  samplesPerPeriod = 90,
  minSamples = 16,
): PackedOrbits {
  const n = Math.max(minSamples, Math.round(samplesPerPeriod * w.periods)) + 1;
  const counts = new Uint32Array(satrecs.length);
  const buf = new Float32Array(satrecs.length * n * 3);
  let k = 0;
  for (let i = 0; i < satrecs.length; i++) {
    const satrec = satrecs[i];
    if (!satrec) continue;
    const { startMs, endMs } = orbitWindowBounds(orbitalPeriodMin(satrec), w);
    const step = (endMs - startMs) / (n - 1);
    let c = 0;
    for (let s = 0; s < n; s++) {
      const r = propagateToTime(satrec, startMs + s * step);
      if (!r.ok) {
        if (c > 0) break;
        continue;
      }
      buf[k++] = r.state.positionKm.x;
      buf[k++] = r.state.positionKm.y;
      buf[k++] = r.state.positionKm.z;
      c++;
    }
    counts[i] = c;
  }
  return { positionsKm: buf.slice(0, k), counts };
}
