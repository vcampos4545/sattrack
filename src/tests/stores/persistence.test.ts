/**
 * Persistence across reloads: each persisted store writes its slice to
 * storage on change, and a fresh rehydrate (what a page reload does) restores
 * it. Corrupted or older stored copies must not break the app.
 *
 * Under Node, `safeLocalStorage()` is the in-memory fallback, which has the
 * same interface Zustand's persist middleware uses in the browser.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PERSIST_KEYS, safeLocalStorage } from '../../services/storage';
import { DEFAULT_OBSERVER, useObserverStore } from '../../stores/observer-store';
import { DEFAULT_CATEGORY_FILTER, useSatelliteStore } from '../../stores/satellite-store';
import { DEFAULT_SETTINGS, sanitizeSettings, useSettingsStore, type Settings } from '../../stores/settings-store';

const storage = safeLocalStorage();
const stored = (key: string) => JSON.parse(storage.getItem(key) ?? 'null') as { state: Record<string, unknown>; version: number };

/**
 * Simulates a reload: wipe in-memory state, then rehydrate from what was
 * stored. (setState itself persists, so the saved copy is put back first.)
 */
async function reload<T>(
  key: string,
  store: { setState: (s: Partial<T>) => void; persist: { rehydrate: () => Promise<void> | void } },
  blank: Partial<T>,
) {
  const saved = storage.getItem(key);
  store.setState(blank);
  if (saved === null) storage.removeItem(key);
  else storage.setItem(key, saved);
  await store.persist.rehydrate();
}

describe('settings persistence', () => {
  beforeEach(() => {
    storage.removeItem(PERSIST_KEYS.settings);
    useSettingsStore.getState().reset();
  });

  it('restores changed settings after a reload', async () => {
    useSettingsStore.getState().update({ elevationMaskDeg: 25, showTerminator: false, orbitScope: 'all', groundTrackAheadRevs: 3, propagationHz: 5 });
    expect(stored(PERSIST_KEYS.settings).state.elevationMaskDeg).toBe(25);
    await reload(PERSIST_KEYS.settings, useSettingsStore, { ...DEFAULT_SETTINGS });
    const s = useSettingsStore.getState();
    expect(s.elevationMaskDeg).toBe(25);
    expect(s.showTerminator).toBe(false);
    expect(s.orbitScope).toBe('all');
    expect(s.groundTrackAheadRevs).toBe(3);
    expect(s.propagationHz).toBe(5);
  });

  it('reset to defaults is persisted too', async () => {
    useSettingsStore.getState().update({ passCount: 20 });
    useSettingsStore.getState().reset();
    await reload(PERSIST_KEYS.settings, useSettingsStore, { passCount: 3 });
    expect(useSettingsStore.getState().passCount).toBe(DEFAULT_SETTINGS.passCount);
  });

  it('ignores corrupted values and fills fields missing from an older version', async () => {
    storage.setItem(
      PERSIST_KEYS.settings,
      JSON.stringify({
        version: 1,
        state: { elevationMaskDeg: 'ten', passCount: 1e9, showOrbits: 'yes', orbitScope: 'everything', propagationHz: null },
      }),
    );
    await useSettingsStore.persist.rehydrate();
    const s = useSettingsStore.getState();
    expect(s.elevationMaskDeg).toBe(DEFAULT_SETTINGS.elevationMaskDeg);
    expect(s.passCount).toBe(50);
    expect(s.showOrbits).toBe(DEFAULT_SETTINGS.showOrbits);
    expect(s.orbitScope).toBe(DEFAULT_SETTINGS.orbitScope);
    expect(s.propagationHz).toBe(DEFAULT_SETTINGS.propagationHz);
    expect(s.groundTrackAheadRevs).toBe(DEFAULT_SETTINGS.groundTrackAheadRevs);
  });

  it('survives unparseable JSON in storage', async () => {
    storage.setItem(PERSIST_KEYS.settings, '{not json');
    await expect(Promise.resolve(useSettingsStore.persist.rehydrate())).resolves.not.toThrow();
    expect(useSettingsStore.getState().elevationMaskDeg).toBe(DEFAULT_SETTINGS.elevationMaskDeg);
  });

  it('sanitizeSettings keeps every key and clamps each numeric range', () => {
    const extreme = Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, typeof v === 'number' ? 1e9 : v]),
    ) as unknown as Settings;
    const s = sanitizeSettings(extreme);
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(s.elevationMaskDeg).toBe(89);
    expect(s.footprintMinElevationDeg).toBe(89);
    expect(s.passSearchDays).toBe(30);
    expect(s.passScanStepS).toBe(300);
    expect(s.orbitLengthPeriods).toBe(10);
    expect(s.propagationHz).toBe(30);
    expect(s.autoRefreshHours).toBe(24 * 7);
    expect(s.groundTrackAheadRevs).toBe(3);
  });
});

describe('observer persistence', () => {
  it('restores a manually entered location after a reload', async () => {
    useObserverStore.getState().setLocation({ latitudeDeg: -33.8688, longitudeDeg: 151.2093, altitudeM: 58, source: 'manual', label: 'Sydney' });
    await reload(PERSIST_KEYS.observer, useObserverStore, { location: DEFAULT_OBSERVER });
    expect(useObserverStore.getState().location).toMatchObject({ latitudeDeg: -33.8688, longitudeDeg: 151.2093, altitudeM: 58, label: 'Sydney' });
  });
});

describe('tracked selection persistence', () => {
  it('restores enabled groups, removed objects, added NORAD ids, filters and the selection', async () => {
    useSatelliteStore.setState({
      enabledGroups: ['stations', 'starlink'],
      untrackedIds: [48274],
      extraNoradIds: [5],
      categoryFilter: { ...DEFAULT_CATEGORY_FILTER, starlink: false },
      selectedId: 25544,
    });
    await reload(PERSIST_KEYS.satellites, useSatelliteStore, {
      enabledGroups: [],
      untrackedIds: [],
      extraNoradIds: [],
      categoryFilter: { ...DEFAULT_CATEGORY_FILTER },
      selectedId: null,
    });
    const s = useSatelliteStore.getState();
    expect(s.enabledGroups).toEqual(['stations', 'starlink']);
    expect(s.untrackedIds).toEqual([48274]);
    expect(s.extraNoradIds).toEqual([5]);
    expect(s.categoryFilter.starlink).toBe(false);
    expect(s.categoryFilter.iss).toBe(true);
    expect(s.selectedId).toBe(25544);
    // Runtime data is never persisted.
    expect(stored(PERSIST_KEYS.satellites).state).not.toHaveProperty('satellites');
  });

  it('restoreUntracked brings removed objects back', () => {
    useSatelliteStore.setState({ untrackedIds: [1, 2, 3] });
    useSatelliteStore.getState().restoreUntracked();
    expect(useSatelliteStore.getState().untrackedIds).toEqual([]);
  });
});
