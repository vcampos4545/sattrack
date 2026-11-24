import { useEffect } from 'react';
import { useSatelliteStore } from '../stores/satellite-store';
import { useSettingsStore } from '../stores/settings-store';

/** How often to check whether the cached catalog has passed its refresh interval. */
const AUTO_REFRESH_CHECK_MS = 10 * 60 * 1000;

/**
 * Loads the catalog once on startup (cache first; see satellite-catalog.ts)
 * and re-loads when the cache passes the user's auto-refresh interval.
 * Mount once, at the app root.
 */
export function useCatalogBootstrap(): void {
  useEffect(() => {
    void useSatelliteStore.getState().loadCatalog();
    const id = setInterval(() => {
      const { lastLoadedAtMs, loadState, loadCatalog } = useSatelliteStore.getState();
      const maxAgeMs = useSettingsStore.getState().autoRefreshHours * 3_600_000;
      // Wall clock on purpose: data age is about real downloads, not simulation time.
      if (loadState !== 'loading' && (lastLoadedAtMs === null || Date.now() - lastLoadedAtMs >= maxAgeMs)) {
        void loadCatalog();
      }
    }, AUTO_REFRESH_CHECK_MS);
    return () => clearInterval(id);
  }, []);
}
