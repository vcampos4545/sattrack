import { useEffect } from 'react';
import { useSatelliteStore } from '../stores/satellite-store';
import { useSettingsStore } from '../stores/settings-store';
import { catalogReloadDue } from '../services/catalog-health';

/** How often to check whether the cached catalog has passed its refresh interval. */
const AUTO_REFRESH_CHECK_MS = 5 * 60 * 1000;

function hadErrors(): boolean {
  const s = useSatelliteStore.getState();
  return s.loadState === 'error' || s.groupStatus.some((g) => g.error) || s.extraStatus.some((e) => e.error);
}

/**
 * Loads the catalog once on startup (cache first; see satellite-catalog.ts),
 * re-loads when the cache passes the user's auto-refresh interval, retries
 * failed downloads every 15 min, and retries as soon as the browser comes
 * back online. Mount once, at the app root.
 */
export function useCatalogBootstrap(): void {
  useEffect(() => {
    void useSatelliteStore.getState().loadCatalog();
    const check = () => {
      const { lastLoadedAtMs, loadState, loadCatalog } = useSatelliteStore.getState();
      const due = catalogReloadDue({
        nowMs: Date.now(),
        lastLoadedAtMs,
        loading: loadState === 'loading',
        hadErrors: hadErrors(),
        autoRefreshHours: useSettingsStore.getState().autoRefreshHours,
      });
      if (due) void loadCatalog();
    };
    const onOnline = () => {
      const { loadState, loadCatalog } = useSatelliteStore.getState();
      if (loadState !== 'loading' && hadErrors()) {
        console.info('[catalog] back online, retrying failed downloads');
        void loadCatalog();
      }
    };
    const id = setInterval(check, AUTO_REFRESH_CHECK_MS);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', onOnline);
    };
  }, []);
}
