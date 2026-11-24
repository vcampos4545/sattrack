import { useFrame } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';
import { computeFootprint, observerFootprintVisibility, type Footprint } from '../../core/orbit/footprint';
import { computeSatelliteState } from '../../core/orbit/satellite-propagator';
import type { SatRec } from '../../core/orbit/sgp4';
import { getSimTimeMs } from '../../stores/time-store';
import type { SatelliteState } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';

/**
 * Per-frame state of the selected satellite, shared by the scene objects of
 * the ground-track globe through a ref (no React re-render per frame).
 */
export interface LiveSatellite {
  /** Propagated state at the last frame's simulation time, or null (nothing selected / SGP4 failed). */
  state: SatelliteState | null;
  footprint: Footprint | null;
  /** Bumped whenever `footprint` is recomputed, so consumers can rebuild geometry lazily. */
  footprintVersion: number;
  /** Observer sees the satellite at or above the footprint's minimum elevation. */
  observerInside: boolean;
}

export const EMPTY_LIVE: LiveSatellite = { state: null, footprint: null, footprintVersion: 0, observerInside: false };

/**
 * Recompute the footprint when the satellite has moved this far (km) since the
 * last one. The boundary is a root search per azimuth (see footprint.ts);
 * at 1x this is ~1-2 Hz for a LEO object and almost never for GEO, while fast
 * playback still updates it every frame.
 */
const FOOTPRINT_MOVE_KM = 5;

/**
 * Drives `live` from the simulation clock every frame. Runs before the other
 * frame callbacks (priority -1) so every consumer sees the same instant.
 * One SGP4 evaluation per frame for one object; bulk propagation stays in
 * the primary globe at `propagationHz`.
 */
export function useLiveSatelliteDriver(
  live: RefObject<LiveSatellite>,
  satrec: SatRec | null,
  observer: ObserverLocation,
  minElevationDeg: number,
): void {
  /** Inputs of the current footprint: satellite, mask, and where the satellite was. */
  const basis = useRef<{ satrec: SatRec; minElevationDeg: number; x: number; y: number; z: number } | null>(null);
  useFrame(() => {
    const cur = live.current;
    if (!satrec) {
      if (cur.state || cur.footprint) Object.assign(cur, { ...EMPTY_LIVE, footprintVersion: cur.footprintVersion + 1 });
      basis.current = null;
      return;
    }
    const state = computeSatelliteState(satrec, getSimTimeMs());
    cur.state = state;
    if (!state) {
      if (cur.footprint) {
        cur.footprint = null;
        cur.footprintVersion++;
      }
      basis.current = null;
      cur.observerInside = false;
      return;
    }
    const p = state.ecef.positionKm;
    const b = basis.current;
    const stale =
      !b ||
      b.satrec !== satrec ||
      b.minElevationDeg !== minElevationDeg ||
      Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) > FOOTPRINT_MOVE_KM;
    if (stale) {
      cur.footprint = computeFootprint(p, minElevationDeg);
      cur.footprintVersion++;
      basis.current = { satrec, minElevationDeg, x: p.x, y: p.y, z: p.z };
    }
    // Visibility is one look-angle evaluation, so it is exact every frame.
    cur.observerInside = observerFootprintVisibility(p, observer, minElevationDeg).inside;
  }, -1);
}

