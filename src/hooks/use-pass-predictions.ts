import { useEffect, useMemo } from 'react';
import { retainPassScheduler } from '../services/pass-scheduler';
import { findPass, usePassStore, type PassStoreState } from '../stores/pass-store';
import { useSatelliteStore } from '../stores/satellite-store';
import type { Pass } from '../types/passes';

/**
 * Predicted passes for the selected satellite. Mounting this hook keeps the
 * pass scheduler running (it is shared and reference counted), so any panel
 * that shows passes can call it without caring which panel mounted first.
 */
export function usePassPredictions(): PassStoreState {
  useEffect(() => retainPassScheduler(), []);
  return usePassStore();
}

/** The pass the user selected (`selectedPassId`), or null. Also keeps the scheduler running. */
export function useSelectedPass(): Pass | null {
  useEffect(() => retainPassScheduler(), []);
  const passes = usePassStore((s) => s.passes);
  const passId = useSatelliteStore((s) => s.selectedPassId);
  return useMemo(() => findPass(passes, passId), [passes, passId]);
}
