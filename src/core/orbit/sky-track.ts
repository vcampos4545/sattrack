/**
 * Sky-plot geometry built on look angles: sampled az/el tracks, the arc of
 * the sky a satellite traces while above an elevation mask, and the angle
 * between two pointing directions (for antenna pointing error).
 *
 * Kept separate from `sky-coordinates.ts` because it propagates (it calls
 * SGP4), while `sky-coordinates.ts` is pure geometry that the propagator
 * itself imports. Putting these here avoids an import cycle.
 *
 * Units: times are UTC ms (simulation time, passed in by the caller; nothing
 * here reads the system clock), angles are degrees, ranges km, range rates
 * km/s. Elevations are geometric (no refraction), like `computeLookAngles`.
 *
 * Arc search method: a coarse scan at `scanStepMs` finds the first sample
 * above the mask, then bisection refines the rise (AOS) and set (LOS)
 * crossings to `REFINE_TOLERANCE_MS`, and a golden-section search refines
 * the culmination (maximum elevation). Limitation of any fixed-step scan: an
 * arc that stays above the mask for less than one scan step can be missed.
 * With the default 30 s step that only affects grazing passes that barely
 * clear the mask.
 *
 * This is the sky plot's own arc finder. The full pass table (many passes,
 * search settings) lives in the passes module; both produce the shared
 * `Pass` type, and the sky plot finds a selected pass again from its id.
 */
import type { SatRec } from 'satellite.js';
import type { AzEl } from '../../types/antenna';
import type { LookAngles } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';
import type { Pass, PassTrackSample } from '../../types/passes';
import { DEG_TO_RAD, RAD_TO_DEG } from './constants';
import { temeToEcef } from './coordinate-transformations';
import { propagateToTime } from './sgp4';
import { computeLookAngles } from './sky-coordinates';
import { gmstRad } from './time-utils';

/** AOS/LOS bisection stops when the bracket is narrower than this, ms. */
export const REFINE_TOLERANCE_MS = 250;

/**
 * Look angles at one instant. Same pipeline as `lookAnglesAt` (TEME -> ECEF
 * -> ENU) but skips the geodetic conversion, which scans do not need.
 * Returns null when SGP4 fails at that time.
 */
export function lookAnglesFast(satrec: SatRec, observer: ObserverLocation, timeMs: number): LookAngles | null {
  const result = propagateToTime(satrec, timeMs);
  if (!result.ok) return null;
  return computeLookAngles(temeToEcef(result.state, gmstRad(timeMs)), observer);
}

function toSample(timeMs: number, look: LookAngles): PassTrackSample {
  return {
    timeMs,
    azimuthDeg: look.azimuthDeg,
    elevationDeg: look.elevationDeg,
    rangeKm: look.rangeKm,
    rangeRateKmS: look.rangeRateKmS,
  };
}

/**
 * Samples observer-relative look angles from `startMs` to `endMs` inclusive,
 * every `stepMs`. Samples where SGP4 fails are skipped. Includes samples
 * below the horizon: the plot decides what to draw.
 */
export function sampleSkyTrack(
  satrec: SatRec,
  observer: ObserverLocation,
  startMs: number,
  endMs: number,
  stepMs: number,
): PassTrackSample[] {
  if (!(stepMs > 0)) throw new Error('stepMs must be positive');
  const out: PassTrackSample[] = [];
  for (let t = startMs; t < endMs; t += stepMs) {
    const look = lookAnglesFast(satrec, observer, t);
    if (look) out.push(toSample(t, look));
  }
  const last = lookAnglesFast(satrec, observer, endMs);
  if (last) out.push(toSample(endMs, last));
  return out;
}

export interface SkyArcOptions {
  /** Elevation mask, degrees. The arc is the interval with elevation >= mask. */
  maskDeg: number;
  /** How far to look forward for a rise, and backward for an in-progress arc's rise, ms. */
  searchMs: number;
  /** Coarse scan step, ms. */
  scanStepMs: number;
  /** Approximate number of track samples between AOS and LOS. Default 120. */
  trackSamples?: number;
}

/**
 * Finds the above-mask arc that contains `fromMs`, or else the next one that
 * starts after it, and returns it as a `Pass` with a sampled track.
 *
 * Returns null when there is no complete arc to report: the satellite stays
 * below the mask for the whole search window (never rises), or stays above
 * it for the whole window (for example a geostationary satellite in view),
 * or SGP4 cannot propagate. Elevation where SGP4 fails counts as below.
 */
export function findSkyArc(
  satrec: SatRec,
  observer: ObserverLocation,
  noradId: number,
  fromMs: number,
  opts: SkyArcOptions,
): Pass | null {
  const { maskDeg, searchMs, scanStepMs } = opts;
  if (!(scanStepMs > 0) || !(searchMs > 0)) throw new Error('scanStepMs and searchMs must be positive');
  /** Elevation above the mask; negative (below) when propagation fails. */
  const margin = (t: number) => {
    const look = lookAnglesFast(satrec, observer, t);
    return look ? look.elevationDeg - maskDeg : -Infinity;
  };

  let aosMs: number;
  if (margin(fromMs) >= 0) {
    // Already up: walk back to the rise.
    const below = scanFor(margin, fromMs, -scanStepMs, fromMs - searchMs, false);
    if (below === null) return null;
    aosMs = Math.round(bisect(margin, below, below + scanStepMs));
  } else {
    const above = scanFor(margin, fromMs, scanStepMs, fromMs + searchMs, true);
    if (above === null) return null;
    aosMs = Math.round(bisect(margin, above - scanStepMs, above));
  }

  // Walk forward from the rise to the set.
  const belowAfter = scanFor(margin, aosMs, scanStepMs, aosMs + searchMs, false);
  if (belowAfter === null) return null;
  // Whole milliseconds, so ids and track endpoints compare exactly.
  const losMs = Math.round(bisect(margin, belowAfter - scanStepMs, belowAfter));

  // Culmination: coarse maximum, then golden-section refine around it.
  const elevation = (t: number) => margin(t) + maskDeg;
  let bestT = aosMs;
  let bestEl = -Infinity;
  for (let t = aosMs; t <= losMs; t += scanStepMs) {
    const el = elevation(t);
    if (el > bestEl) {
      bestEl = el;
      bestT = t;
    }
  }
  const maxElevationMs = Math.round(goldenMax(elevation, Math.max(aosMs, bestT - scanStepMs), Math.min(losMs, bestT + scanStepMs)));

  const at = (t: number) => lookAnglesFast(satrec, observer, t);
  const aosLook = at(aosMs);
  const losLook = at(losMs);
  const maxLook = at(maxElevationMs);
  if (!aosLook || !losLook || !maxLook) return null;

  const samples = Math.max(2, opts.trackSamples ?? 120);
  const trackStep = Math.max(1000, (losMs - aosMs) / samples);
  const track = sampleSkyTrack(satrec, observer, aosMs, losMs, trackStep);
  // Make sure the culmination itself is on the drawn track.
  const insertAt = track.findIndex((s) => s.timeMs > maxElevationMs);
  if (insertAt > 0 && track[insertAt - 1]!.timeMs !== maxElevationMs) {
    track.splice(insertAt, 0, toSample(maxElevationMs, maxLook));
  }

  return {
    id: `${noradId}-${aosMs}`,
    noradId,
    elevationMaskDeg: maskDeg,
    aosMs,
    aosAzimuthDeg: aosLook.azimuthDeg,
    losMs,
    losAzimuthDeg: losLook.azimuthDeg,
    maxElevationMs,
    maxElevationDeg: maxLook.elevationDeg,
    maxElevationAzimuthDeg: maxLook.azimuthDeg,
    durationS: (losMs - aosMs) / 1000,
    // The rise was refined backward, so aosMs is a real rise time.
    inProgressAtSearchStart: false,
    track,
  };
}

/**
 * Steps from `startMs` by `stepMs` (either sign) until `margin >= 0` equals
 * `wantAbove`, never passing `limitMs`. Returns that sample time or null.
 */
function scanFor(
  margin: (t: number) => number,
  startMs: number,
  stepMs: number,
  limitMs: number,
  wantAbove: boolean,
): number | null {
  const forward = stepMs > 0;
  for (let t = startMs + stepMs; forward ? t <= limitMs : t >= limitMs; t += stepMs) {
    if (margin(t) >= 0 === wantAbove) return t;
  }
  return null;
}

/** Bisects a sign change of `margin` between `a` and `b` to `REFINE_TOLERANCE_MS`. */
function bisect(margin: (t: number) => number, a: number, b: number): number {
  const aAbove = margin(a) >= 0;
  let lo = a;
  let hi = b;
  while (hi - lo > REFINE_TOLERANCE_MS) {
    const mid = (lo + hi) / 2;
    if (margin(mid) >= 0 === aAbove) lo = mid;
    else hi = mid;
  }
  // Report the instant on the above-mask side so AOS/LOS sit at the mask.
  return aAbove ? lo : hi;
}

const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** Golden-section search for the maximum of a unimodal `f` on [a, b], to 100 ms. */
function goldenMax(f: (t: number) => number, a: number, b: number): number {
  let lo = a;
  let hi = b;
  let x1 = hi - GOLDEN * (hi - lo);
  let x2 = lo + GOLDEN * (hi - lo);
  let f1 = f(x1);
  let f2 = f(x2);
  while (hi - lo > 100) {
    if (f1 < f2) {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + GOLDEN * (hi - lo);
      f2 = f(x2);
    } else {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - GOLDEN * (hi - lo);
      f1 = f(x1);
    }
  }
  return (lo + hi) / 2;
}

/** Parses a `Pass.id` (`${noradId}-${aosMs}`). Returns null for anything else. */
export function parsePassId(id: string): { noradId: number; aosMs: number } | null {
  const m = /^(\d+)-(-?\d+(?:\.\d+)?)$/.exec(id);
  if (!m) return null;
  const noradId = Number(m[1]);
  const aosMs = Number(m[2]);
  return Number.isFinite(noradId) && Number.isFinite(aosMs) ? { noradId, aosMs } : null;
}

/**
 * Angle between two pointing directions on the sky sphere, degrees, [0, 180].
 * This is the true pointing error: unlike a plain azimuth difference it does
 * not blow up near the zenith, where azimuth changes fast but the direction
 * barely moves. Uses the haversine form, which stays accurate for small angles.
 */
export function angularSeparationDeg(a: AzEl, b: AzEl): number {
  const el1 = a.elevationDeg * DEG_TO_RAD;
  const el2 = b.elevationDeg * DEG_TO_RAD;
  const dAz = (b.azimuthDeg - a.azimuthDeg) * DEG_TO_RAD;
  const h = Math.sin((el2 - el1) / 2) ** 2 + Math.cos(el1) * Math.cos(el2) * Math.sin(dAz / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * RAD_TO_DEG;
}
