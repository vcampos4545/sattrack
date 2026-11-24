/**
 * Thin wrapper around satellite.js, the SGP4/SDP4 implementation used here.
 *
 * Why satellite.js: it is a maintained JavaScript port of David Vallado's
 * reference SGP4 code ("Revisiting Spacetrack Report #3", 2006), handles both
 * near-Earth (SGP4) and deep-space (SDP4) orbits, ships TypeScript types and
 * reproduces Vallado's published verification vectors (see
 * `src/tests/orbit/sgp4.test.ts`). We do not reimplement propagation.
 *
 * Output frame: TEME, km and km/s. satellite.js uses the WGS72 gravity model
 * internally, which is what TLEs are generated against. Do not mix this with
 * WGS84; WGS84 is only used for the geodetic (lat/lon/alt) conversion.
 */
import { propagate, sgp4, twoline2satrec, type SatRec } from 'satellite.js';
import type { TemeState } from '../../types/orbital';
import type { TleRecord } from '../../types/satellite';

export type { SatRec };

/** satellite.js error codes (`SatRec.error`) mapped to readable text. */
const SGP4_ERRORS: Record<number, string> = {
  1: 'mean eccentricity out of range',
  2: 'mean motion below zero',
  3: 'perturbed eccentricity out of range',
  4: 'semi-latus rectum below zero',
  6: 'orbit has decayed',
};

export function describeSgp4Error(code: number): string {
  return SGP4_ERRORS[code] ?? `SGP4 error ${code}`;
}

export type PropagationResult =
  | { ok: true; state: TemeState }
  | { ok: false; error: string };

/** Initializes SGP4 for a TLE. Throws if SGP4 rejects the elements. */
export function createSatrec(tle: Pick<TleRecord, 'line1' | 'line2'>): SatRec {
  const satrec = twoline2satrec(tle.line1, tle.line2);
  if (satrec.error !== 0) {
    throw new Error(`SGP4 initialization failed: ${describeSgp4Error(satrec.error)}`);
  }
  return satrec;
}

/**
 * Cache of initialized SatRecs keyed by TleRecord object identity. Catalog
 * refreshes replace TleRecord objects, so stale SatRecs are garbage-collected
 * automatically and never reused for new elements.
 */
const satrecCache = new WeakMap<TleRecord, SatRec>();

/** Returns the (cached) SatRec for a TLE record. Throws like `createSatrec`. */
export function satrecFor(tle: TleRecord): SatRec {
  let satrec = satrecCache.get(tle);
  if (!satrec) {
    satrec = createSatrec(tle);
    satrecCache.set(tle, satrec);
  }
  return satrec;
}

function toResult(satrec: SatRec, pv: ReturnType<typeof propagate>): PropagationResult {
  if (!pv) return { ok: false, error: describeSgp4Error(satrec.error) };
  return {
    ok: true,
    state: {
      positionKm: { x: pv.position.x, y: pv.position.y, z: pv.position.z },
      velocityKmS: { x: pv.velocity.x, y: pv.velocity.y, z: pv.velocity.z },
    },
  };
}

/** Propagates to an absolute UTC instant (ms). Output in TEME. */
export function propagateToTime(satrec: SatRec, timeMs: number): PropagationResult {
  return toResult(satrec, propagate(satrec, new Date(timeMs)));
}

/**
 * Propagates to a time offset from the element epoch, in minutes. This is the
 * raw SGP4 interface used by the Vallado verification vectors.
 */
export function propagateMinutesSinceEpoch(satrec: SatRec, minutes: number): PropagationResult {
  return toResult(satrec, sgp4(satrec, minutes));
}
