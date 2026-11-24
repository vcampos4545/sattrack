/**
 * Sky-plot geometry built on look angles: sampled az/el tracks for the live
 * path around now, and the angle between two pointing directions (for
 * antenna pointing error). Passes (AOS / max / LOS) come from
 * `pass-prediction.ts`; this module does not search for them.
 *
 * Kept separate from `sky-coordinates.ts` because it propagates (it calls
 * SGP4), while `sky-coordinates.ts` is pure geometry that the propagator
 * itself imports. Putting these here avoids an import cycle.
 *
 * Units: times are UTC ms (simulation time, passed in by the caller; nothing
 * here reads the system clock), angles are degrees, ranges km, range rates
 * km/s. Elevations are geometric (no refraction), like `computeLookAngles`.
 */
import type { SatRec } from 'satellite.js';
import type { AzEl } from '../../types/antenna';
import type { LookAngles } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';
import type { PassTrackSample } from '../../types/passes';
import { DEG_TO_RAD, RAD_TO_DEG } from './constants';
import { temeToEcef } from './coordinate-transformations';
import { propagateToTime } from './sgp4';
import { computeLookAngles } from './sky-coordinates';
import { gmstRad } from './time-utils';

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
