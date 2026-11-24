/**
 * High-level propagation helpers built on `sgp4.ts` and the frame transforms.
 * These are the entry points UI code should use; components never call
 * satellite.js directly.
 */
import type { SatRec } from 'satellite.js';
import type { LookAngles, SatelliteState, TemeState } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';
import { ecefToGeodetic, temeToEcef, vecMagnitude } from './coordinate-transformations';
import { propagateToTime } from './sgp4';
import { computeLookAngles } from './sky-coordinates';
import { gmstRad } from './time-utils';

/**
 * Full state of one satellite at `timeMs` (UTC ms, simulation time).
 * Returns null when SGP4 fails (e.g. decayed orbit); callers should surface
 * that rather than display a position.
 */
export function computeSatelliteState(satrec: SatRec, timeMs: number): SatelliteState | null {
  const result = propagateToTime(satrec, timeMs);
  if (!result.ok) return null;
  return deriveSatelliteState(result.state, timeMs);
}

/** Derives Earth-fixed and geodetic data from a TEME state at `timeMs`. */
export function deriveSatelliteState(teme: TemeState, timeMs: number): SatelliteState {
  const gmst = gmstRad(timeMs);
  const ecef = temeToEcef(teme, gmst);
  return {
    timeMs,
    teme,
    ecef,
    geodetic: ecefToGeodetic(ecef.positionKm),
    inertialSpeedKmS: vecMagnitude(teme.velocityKmS),
    gmstRad: gmst,
  };
}

/** Look angles of a satellite from an observer at `timeMs`, or null if SGP4 fails. */
export function lookAnglesAt(satrec: SatRec, observer: ObserverLocation, timeMs: number): LookAngles | null {
  const state = computeSatelliteState(satrec, timeMs);
  return state ? computeLookAngles(state.ecef, observer) : null;
}

/**
 * Output buffers for `propagateBatch`. Layout is [x0, y0, z0, x1, y1, z1, ...]
 * so the arrays can feed Three.js buffer attributes or be transferred to a
 * Web Worker without conversion.
 */
export interface BatchBuffers {
  /** TEME positions, km. */
  positionsKm: Float64Array;
  /** TEME velocities, km/s. */
  velocitiesKmS: Float64Array;
  /** 1 when slot i propagated successfully, 0 when SGP4 failed. */
  valid: Uint8Array;
}

export function createBatchBuffers(count: number): BatchBuffers {
  return {
    positionsKm: new Float64Array(count * 3),
    velocitiesKmS: new Float64Array(count * 3),
    valid: new Uint8Array(count),
  };
}

/**
 * Propagates many satellites to one instant, writing TEME states into
 * preallocated buffers (no per-satellite allocation besides satellite.js's
 * own). Returns the number of satellites that propagated successfully.
 *
 * TEME is the natural frame for bulk work: one GMST rotation per frame can be
 * applied by the renderer (e.g. by rotating the Earth mesh), and positions can
 * be linearly extrapolated between ticks using the velocities.
 */
export function propagateBatch(satrecs: readonly SatRec[], timeMs: number, out: BatchBuffers): number {
  let ok = 0;
  for (let i = 0; i < satrecs.length; i++) {
    const satrec = satrecs[i];
    const result = satrec ? propagateToTime(satrec, timeMs) : null;
    const j = i * 3;
    if (result?.ok) {
      const { positionKm: p, velocityKmS: v } = result.state;
      out.positionsKm[j] = p.x;
      out.positionsKm[j + 1] = p.y;
      out.positionsKm[j + 2] = p.z;
      out.velocitiesKmS[j] = v.x;
      out.velocitiesKmS[j + 1] = v.y;
      out.velocitiesKmS[j + 2] = v.z;
      out.valid[i] = 1;
      ok++;
    } else {
      out.valid[i] = 0;
    }
  }
  return ok;
}

/**
 * Samples a satellite's trajectory between two instants, inclusive of both
 * ends. Failed samples (SGP4 errors) are skipped. Use this for orbit paths
 * (TEME) and ground tracks (`state.geodetic`).
 */
export function sampleTrajectory(
  satrec: SatRec,
  startMs: number,
  endMs: number,
  stepMs: number,
): SatelliteState[] {
  if (!(stepMs > 0)) throw new Error('stepMs must be positive');
  const samples: SatelliteState[] = [];
  for (let t = startMs; t < endMs; t += stepMs) {
    const s = computeSatelliteState(satrec, t);
    if (s) samples.push(s);
  }
  const last = computeSatelliteState(satrec, endMs);
  if (last) samples.push(last);
  return samples;
}

/** Orbital period from SGP4's Kozai-corrected mean motion (rad/min), minutes. */
export function orbitalPeriodMin(satrec: SatRec): number {
  return (2 * Math.PI) / satrec.no;
}
