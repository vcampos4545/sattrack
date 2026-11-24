import { useMemo } from 'react';
import { lookAnglesAt } from '../core/orbit/satellite-propagator';
import { satrecFor } from '../core/orbit/sgp4';
import { useObserverStore } from '../stores/observer-store';
import { selectSelectedSatellite, useSatelliteStore } from '../stores/satellite-store';
import type { LookAngles } from '../types/orbital';
import { useSimTimeMs } from './use-sim-time';

/**
 * Look angles of the selected satellite from the observer at the current
 * simulation time, refreshed at `hz`. Null when nothing is selected or SGP4
 * fails. For text panels; 3D views should compute in their frame loop.
 */
export function useLiveLookAngles(hz = 1): { look: LookAngles | null; timeMs: number } {
  const record = useSatelliteStore(selectSelectedSatellite);
  const observer = useObserverStore((s) => s.location);
  const timeMs = useSimTimeMs(hz);
  return useMemo(() => {
    if (!record) return { look: null, timeMs };
    try {
      return { look: lookAnglesAt(satrecFor(record.tle), observer, timeMs), timeMs };
    } catch {
      return { look: null, timeMs };
    }
  }, [record, observer, timeMs]);
}
