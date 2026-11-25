import { useMemo, useSyncExternalStore } from 'react';
import { summarizeCatalogHealth, type CatalogHealth } from '../services/catalog-health';
import { useSatelliteStore } from '../stores/satellite-store';
import { getWallClockMs } from '../stores/time-store';
import { useSimTimeMs } from './use-sim-time';

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** `navigator.onLine`, live. True when the browser does not know. */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    () => true,
  );
}

/**
 * Catalog health at the current simulation time, re-evaluated about every
 * 10 s (epoch and data age change slowly) and on any catalog change.
 */
export function useCatalogHealth(): CatalogHealth & { simTimeMs: number; wallNowMs: number } {
  const simTimeMs = useSimTimeMs(0.1);
  const satellites = useSatelliteStore((s) => s.satellites);
  const groupStatus = useSatelliteStore((s) => s.groupStatus);
  const extraStatus = useSatelliteStore((s) => s.extraStatus);
  const loadState = useSatelliteStore((s) => s.loadState);
  const loadError = useSatelliteStore((s) => s.loadError);
  const browserOnline = useBrowserOnline();
  // Wall clock on purpose: data age is about real downloads (see catalog-health.ts).
  const wallNowMs = getWallClockMs();
  // Bucket sim time to 10 s so a live clock does not redo the epoch scan more often.
  const simBucket = Math.floor(simTimeMs / 10_000) * 10_000;
  const wallBucket = Math.floor(wallNowMs / 10_000) * 10_000;
  return useMemo(
    () => ({
      ...summarizeCatalogHealth({
        satellites,
        groupStatus,
        extraStatus,
        loadState,
        loadError,
        simTimeMs: simBucket,
        wallNowMs: wallBucket,
        browserOnline,
      }),
      simTimeMs: simBucket,
      wallNowMs: wallBucket,
    }),
    [satellites, groupStatus, extraStatus, loadState, loadError, simBucket, wallBucket, browserOnline],
  );
}
