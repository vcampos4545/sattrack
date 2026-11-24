import { useMemo } from 'react';
import { computeSatelliteState } from '../core/orbit/satellite-propagator';
import { satrecFor } from '../core/orbit/sgp4';
import { selectSelectedSatellite, useSatelliteStore } from '../stores/satellite-store';
import type { SatelliteState } from '../types/orbital';
import type { SatelliteRecord } from '../types/satellite';
import { useSimTimeMs } from './use-sim-time';

export interface SelectedSatelliteSnapshot {
  record: SatelliteRecord | null;
  /** Propagated state at `timeMs`, or null when nothing is selected or SGP4 failed. */
  state: SatelliteState | null;
  /** SGP4 failure (e.g. decayed), so the UI can say why there is no position. */
  error: string | null;
  timeMs: number;
}

/**
 * The selected satellite and its propagated state at the current simulation
 * time, refreshed at `hz`. For text panels; not for per-frame rendering.
 */
export function useSelectedSatellite(hz = 1): SelectedSatelliteSnapshot {
  const record = useSatelliteStore(selectSelectedSatellite);
  const timeMs = useSimTimeMs(hz);
  return useMemo(() => {
    if (!record) return { record, state: null, error: null, timeMs };
    try {
      const state = computeSatelliteState(satrecFor(record.tle), timeMs);
      return { record, state, error: state ? null : 'SGP4 could not propagate this element set (decayed?)', timeMs };
    } catch (err) {
      return { record, state: null, error: (err as Error).message, timeMs };
    }
  }, [record, timeMs]);
}
