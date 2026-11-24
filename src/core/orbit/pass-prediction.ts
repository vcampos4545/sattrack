/**
 * Pass prediction: when a satellite rises above, peaks in, and sets below an
 * observer's elevation mask.
 *
 * Method
 * ------
 * 1. Coarse scan. Elevation is evaluated on a fixed grid of `scanStepS`
 *    seconds. The grid is aligned to absolute multiples of the step (not to
 *    the search start), so two searches started at different instants sample
 *    the same times and refine to identical AOS times. That keeps `Pass.id`
 *    (`${noradId}-${aosMs}`) stable when passes are recomputed as simulation
 *    time advances.
 * 2. Crossings. A grid interval whose ends straddle the mask holds an AOS
 *    (rising) or LOS (setting). It is refined by bisection on
 *    f(t) = elevation(t) - mask to `CROSSING_TOLERANCE_MS`. The refined time
 *    is the bracket end on the visible side, so AOS/LOS samples sit at or
 *    just above the mask.
 * 3. Maximum elevation. Golden-section search over the two grid intervals
 *    around the highest coarse sample of the pass, to `MAX_TOLERANCE_MS`.
 *    Elevation is unimodal over that short bracket for any real orbit.
 * 4. Grazing passes. A pass shorter than one grid step can fall between
 *    samples. Every coarse local maximum within `GRAZE_MARGIN_DEG` below the
 *    mask is refined with golden-section search; if the true peak clears the
 *    mask, AOS and LOS are bisected on either side of it.
 * 5. Pass in progress at the search start. The scan steps backward up to one
 *    orbital period (max 1 day) to find the real rise and refines it. If the
 *    satellite was above the mask for that whole time (e.g. geostationary),
 *    `aosMs` is the search start and `inProgressAtSearchStart` is true.
 * 6. Pass open at the window end. Scanning continues up to 1 day past the
 *    window to find LOS. A pass that never sets within that is dropped; if
 *    the satellite was above the mask for the whole scan, the result status is
 *    `always-above-mask` (typical for a visible geostationary satellite).
 *
 * Every elevation comes from SGP4 (TEME) -> GMST rotation (ECEF/PEF) ->
 * observer ENU (`sky-coordinates.ts`), so observer latitude, longitude and
 * altitude, the Earth's rotation and the satellite's motion are all accounted
 * for. Elevation is geometric (no refraction).
 *
 * Units: times are UTC ms (the caller passes simulation time; this module never
 * reads the clock), angles degrees, distances km, rates km/s.
 */
import type { SatRec } from 'satellite.js';
import type { LookAngles } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';
import type { Pass, PassTrackSample } from '../../types/passes';
import { MS_PER_DAY, MS_PER_MINUTE } from './constants';
import { temeToEcef } from './coordinate-transformations';
import { orbitalPeriodMin } from './satellite-propagator';
import { propagateToTime } from './sgp4';
import { computeLookAngles } from './sky-coordinates';
import { gmstRad } from './time-utils';

/** AOS/LOS bisection stops when the bracket is this short, ms. */
export const CROSSING_TOLERANCE_MS = 10;
/** Maximum-elevation golden-section search stops at this bracket width, ms. */
export const MAX_TOLERANCE_MS = 50;
/** Coarse local maxima this far below the mask are refined to catch short grazing passes, degrees. */
export const GRAZE_MARGIN_DEG = 5;
/** How far past the search window an open pass is followed to find its LOS. */
const PASS_END_EXTENSION_MS = MS_PER_DAY;
/** Upper bound on the backward search for the AOS of a pass already in progress. */
const MAX_LOOKBACK_MS = MS_PER_DAY;
/** Track sample spacing bounds. Short passes get ~1 s resolution, long ones ~180 samples. */
const TRACK_TARGET_SAMPLES = 180;
const TRACK_MIN_STEP_MS = 1000;

export interface PassSearchOptions {
  /** Search start, UTC ms (simulation time). */
  startMs: number;
  /** Minimum elevation for AOS/LOS, degrees. */
  elevationMaskDeg: number;
  /** Stop after this many passes. */
  maxPasses: number;
  /** Search window length from `startMs`, days. */
  searchDays: number;
  /** Coarse scan step, seconds. */
  scanStepS: number;
}

/**
 * - `ok`: at least one pass found.
 * - `never-above-mask`: the satellite stays below the mask for the whole window.
 * - `always-above-mask`: it stays above the mask for the whole scan (no rise or set).
 * - `propagation-error`: SGP4 failed at the search start (e.g. decayed elements).
 */
export type PassSearchStatus = 'ok' | 'never-above-mask' | 'always-above-mask' | 'propagation-error';

export interface PassSearchResult {
  noradId: number;
  status: PassSearchStatus;
  /** Passes in time order, at most `maxPasses`. */
  passes: Pass[];
  searchStartMs: number;
  /** `searchStartMs + searchDays`. */
  windowEndMs: number;
  /** Where scanning stopped: the last LOS when `maxPasses` was reached, else the window end (or later). */
  scannedUntilMs: number;
  elevationMaskDeg: number;
  /** Highest elevation seen on the coarse grid, degrees (approximate; useful when nothing rises). */
  highestSampledElevationDeg: number;
  /** Elevation evaluations (SGP4 propagations) performed. */
  evaluations: number;
  /** Grid samples where SGP4 failed after the start; treated as below the mask. */
  propagationFailures: number;
  /** SGP4 message when status is `propagation-error`. */
  error: string | null;
}

export function passId(noradId: number, aosMs: number): string {
  return `${noradId}-${aosMs}`;
}

/** Look angles at `timeMs`, or null when SGP4 fails. Counts evaluations. */
function createLookFn(satrec: SatRec, observer: ObserverLocation) {
  const fn = (timeMs: number): LookAngles | null => {
    fn.count++;
    const result = propagateToTime(satrec, timeMs);
    if (!result.ok) return null;
    return computeLookAngles(temeToEcef(result.state, gmstRad(timeMs)), observer);
  };
  fn.count = 0;
  return fn;
}

type LookFn = ReturnType<typeof createLookFn>;

/** Elevation with SGP4 failures mapped to -90 (below any mask). */
function elevationOf(look: LookAngles | null): number {
  return look ? look.elevationDeg : -90;
}

/**
 * Bisection for a mask crossing in [aMs, bMs], where exactly one end is
 * visible (elevation >= mask). Returns the integer ms on the visible side.
 */
function refineCrossing(lookFn: LookFn, mask: number, aMs: number, bMs: number): number {
  let lo = aMs;
  let hi = bMs;
  const loVisible = elevationOf(lookFn(lo)) >= mask;
  while (hi - lo > CROSSING_TOLERANCE_MS) {
    const mid = (lo + hi) / 2;
    if (elevationOf(lookFn(mid)) >= mask === loVisible) lo = mid;
    else hi = mid;
  }
  // Rising (lo below): AOS is the first visible instant, round up. Setting: round down.
  return loVisible ? Math.floor(lo) : Math.ceil(hi);
}

const INV_PHI = (Math.sqrt(5) - 1) / 2;

/** Golden-section search for the elevation maximum in [aMs, bMs]. */
function refineMaximum(lookFn: LookFn, aMs: number, bMs: number): { timeMs: number; elevationDeg: number } {
  let a = aMs;
  let b = bMs;
  let c = b - INV_PHI * (b - a);
  let d = a + INV_PHI * (b - a);
  let fc = elevationOf(lookFn(c));
  let fd = elevationOf(lookFn(d));
  while (b - a > MAX_TOLERANCE_MS) {
    if (fc >= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - INV_PHI * (b - a);
      fc = elevationOf(lookFn(c));
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + INV_PHI * (b - a);
      fd = elevationOf(lookFn(d));
    }
  }
  const timeMs = Math.round((a + b) / 2);
  return { timeMs, elevationDeg: elevationOf(lookFn(timeMs)) };
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

/** Samples a pass from AOS to LOS, including the exact AOS, maximum and LOS instants. */
function sampleTrack(lookFn: LookFn, aosMs: number, maxMs: number, losMs: number): PassTrackSample[] {
  const stepMs = Math.max(TRACK_MIN_STEP_MS, (losMs - aosMs) / TRACK_TARGET_SAMPLES);
  const times: number[] = [];
  for (let t = aosMs; t < losMs; t += stepMs) times.push(Math.round(t));
  times.push(losMs, maxMs);
  const unique = [...new Set(times)].sort((x, y) => x - y);
  const track: PassTrackSample[] = [];
  for (const t of unique) {
    const look = lookFn(t);
    if (look) track.push(toSample(t, look));
  }
  return track;
}

interface OpenPass {
  aosMs: number;
  inProgressAtSearchStart: boolean;
  /** Highest coarse sample so far. */
  peakSampleMs: number;
  peakSampleEl: number;
}

/**
 * Predicts the next passes of `satrec` over `observer` starting at
 * `options.startMs`. Pure and synchronous; run it in a worker for long windows.
 */
export function predictPasses(
  satrec: SatRec,
  observer: ObserverLocation,
  options: PassSearchOptions,
  noradId: number = Number(satrec.satnum),
): PassSearchResult {
  const { startMs, elevationMaskDeg: mask } = options;
  const maxPasses = Math.max(1, Math.floor(options.maxPasses));
  const stepMs = Math.max(1, options.scanStepS) * 1000;
  const windowEndMs = startMs + Math.max(0, options.searchDays) * MS_PER_DAY;
  const lookFn = createLookFn(satrec, observer);

  const base: PassSearchResult = {
    noradId,
    status: 'ok',
    passes: [],
    searchStartMs: startMs,
    windowEndMs,
    scannedUntilMs: startMs,
    elevationMaskDeg: mask,
    highestSampledElevationDeg: -90,
    evaluations: 0,
    propagationFailures: 0,
    error: null,
  };

  const startLook = lookFn(startMs);
  if (!startLook) {
    const probe = propagateToTime(satrec, startMs);
    return {
      ...base,
      status: 'propagation-error',
      evaluations: lookFn.count,
      error: probe.ok ? 'SGP4 propagation failed' : probe.error,
    };
  }

  const passes: Pass[] = [];
  let highest = startLook.elevationDeg;
  let failures = 0;
  let open: OpenPass | null = null;

  const closePass = (p: OpenPass, losMs: number, losLook: LookAngles | null) => {
    // Bracket the coarse peak by one step either side, clamped to the pass.
    const lo = Math.max(p.aosMs, p.peakSampleMs - stepMs);
    const hi = Math.min(losMs, p.peakSampleMs + stepMs);
    const peak = refineMaximum(lookFn, lo, hi);
    const aosLook = lookFn(p.aosMs);
    const maxLook = lookFn(peak.timeMs);
    const endLook = losLook ?? lookFn(losMs);
    if (!aosLook || !maxLook || !endLook) return;
    passes.push({
      id: passId(noradId, p.aosMs),
      noradId,
      elevationMaskDeg: mask,
      aosMs: p.aosMs,
      aosAzimuthDeg: aosLook.azimuthDeg,
      losMs,
      losAzimuthDeg: endLook.azimuthDeg,
      maxElevationMs: peak.timeMs,
      maxElevationDeg: maxLook.elevationDeg,
      maxElevationAzimuthDeg: maxLook.azimuthDeg,
      durationS: (losMs - p.aosMs) / 1000,
      inProgressAtSearchStart: p.inProgressAtSearchStart,
      track: sampleTrack(lookFn, p.aosMs, peak.timeMs, losMs),
    });
  };

  // A pass may already be under way at the start: look back for its rise.
  if (startLook.elevationDeg >= mask) {
    open = { aosMs: startMs, inProgressAtSearchStart: true, peakSampleMs: startMs, peakSampleEl: startLook.elevationDeg };
    const lookbackMs = Math.min(MAX_LOOKBACK_MS, orbitalPeriodMin(satrec) * MS_PER_MINUTE);
    let later = startMs;
    for (let t = Math.floor(startMs / stepMs) * stepMs; t >= startMs - lookbackMs; t -= stepMs) {
      if (t === startMs) continue;
      const el = elevationOf(lookFn(t));
      if (el < mask) {
        open.aosMs = refineCrossing(lookFn, mask, t, later);
        open.inProgressAtSearchStart = false;
        break;
      }
      if (el > open.peakSampleEl) {
        open.peakSampleEl = el;
        open.peakSampleMs = t;
      }
      later = t;
    }
  }

  // Forward scan on the aligned grid.
  let prevMs = startMs;
  let prevEl = startLook.elevationDeg;
  let prevPrevMs = Number.NaN;
  let prevPrevEl = Number.NaN;
  let t = Math.floor(startMs / stepMs) * stepMs + stepMs;
  let alwaysAbove = startLook.elevationDeg >= mask;

  while (passes.length < maxPasses) {
    if (!open && t > windowEndMs) break;
    if (open && t > windowEndMs + PASS_END_EXTENSION_MS) {
      // Never set within the extension: no LOS to report.
      open = null;
      break;
    }
    const look = lookFn(t);
    if (!look) failures++;
    const el = elevationOf(look);
    if (el > highest) highest = el;

    if (!open) {
      if (el >= mask) {
        open = { aosMs: refineCrossing(lookFn, mask, prevMs, t), inProgressAtSearchStart: false, peakSampleMs: t, peakSampleEl: el };
      } else if (
        prevEl < mask &&
        prevEl >= mask - GRAZE_MARGIN_DEG &&
        prevEl > el &&
        !Number.isNaN(prevPrevEl) &&
        prevEl >= prevPrevEl
      ) {
        // Coarse local maximum just below the mask: a short pass may hide between samples.
        const peak = refineMaximum(lookFn, prevPrevMs, t);
        if (peak.elevationDeg >= mask) {
          const aosMs = refineCrossing(lookFn, mask, prevPrevMs, peak.timeMs);
          const losMs = refineCrossing(lookFn, mask, peak.timeMs, t);
          closePass(
            { aosMs, inProgressAtSearchStart: false, peakSampleMs: peak.timeMs, peakSampleEl: peak.elevationDeg },
            losMs,
            null,
          );
        }
      }
    } else if (el >= mask) {
      if (el > open.peakSampleEl) {
        open.peakSampleEl = el;
        open.peakSampleMs = t;
      }
    } else {
      alwaysAbove = false;
      const losMs = refineCrossing(lookFn, mask, prevMs, t);
      closePass(open, losMs, null);
      open = null;
    }

    prevPrevMs = prevMs;
    prevPrevEl = prevEl;
    prevMs = t;
    prevEl = el;
    t += stepMs;
  }

  const scannedUntilMs = passes.length >= maxPasses ? (passes[passes.length - 1]?.losMs ?? prevMs) : prevMs;
  let status: PassSearchStatus = 'ok';
  if (passes.length === 0) status = alwaysAbove ? 'always-above-mask' : 'never-above-mask';

  return {
    ...base,
    status,
    passes,
    scannedUntilMs,
    highestSampledElevationDeg: highest,
    evaluations: lookFn.count,
    propagationFailures: failures,
  };
}

/** True when `timeMs` falls inside the pass (AOS inclusive, LOS exclusive). */
export function isPassInProgress(pass: Pick<Pass, 'aosMs' | 'losMs'>, timeMs: number): boolean {
  return timeMs >= pass.aosMs && timeMs < pass.losMs;
}

/** The pass in progress at `timeMs`, else the next one to start, else null. */
export function currentOrNextPass<P extends Pick<Pass, 'aosMs' | 'losMs'>>(passes: readonly P[], timeMs: number): P | null {
  for (const p of passes) if (p.losMs > timeMs) return p;
  return null;
}

const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Compass point for an azimuth (degrees clockwise from north). */
export function compassPoint(azimuthDeg: number, points: 8 | 16 = 8): string {
  const names = points === 16 ? COMPASS_16 : COMPASS_8;
  const sector = 360 / names.length;
  const i = Math.round((((azimuthDeg % 360) + 360) % 360) / sector) % names.length;
  return names[i] ?? 'N';
}

/**
 * General direction of travel across the sky: where it rises and sets, plus
 * whether it moves northward or southward overall (from the north component
 * of the AOS and LOS directions on the horizon).
 */
export function passDirection(pass: Pick<Pass, 'aosAzimuthDeg' | 'losAzimuthDeg'>): {
  from: string;
  to: string;
  heading: 'northbound' | 'southbound' | 'eastbound' | 'westbound';
} {
  const rad = Math.PI / 180;
  const dn = Math.cos(pass.losAzimuthDeg * rad) - Math.cos(pass.aosAzimuthDeg * rad);
  const de = Math.sin(pass.losAzimuthDeg * rad) - Math.sin(pass.aosAzimuthDeg * rad);
  const heading =
    Math.abs(dn) >= Math.abs(de) ? (dn >= 0 ? 'northbound' : 'southbound') : de >= 0 ? 'eastbound' : 'westbound';
  return { from: compassPoint(pass.aosAzimuthDeg), to: compassPoint(pass.losAzimuthDeg), heading };
}
