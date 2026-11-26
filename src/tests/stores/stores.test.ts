import { beforeEach, describe, expect, it } from 'vitest';
import { createSatelliteCatalog } from '../../services/satellite-catalog';
import { createMemoryStore } from '../../services/storage';
import { DEFAULT_OBSERVER, useObserverStore } from '../../stores/observer-store';
import { selectSelectedSatellite, setCatalogService, useSatelliteStore } from '../../stores/satellite-store';
import { DEFAULT_SETTINGS, useSettingsStore } from '../../stores/settings-store';
import { setWallClock, useTimeStore } from '../../stores/time-store';

const ISS = [
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
].join('\n');
const VANGUARD = [
  'VANGUARD 1',
  '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753',
  '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667',
].join('\n');

describe('time store', () => {
  let real = 1_000_000;
  beforeEach(() => {
    real = 1_000_000;
    setWallClock(() => real);
    useTimeStore.getState().resetToLive();
  });

  it('tracks the wall clock in live mode', () => {
    real += 5000;
    expect(useTimeStore.getState().now()).toBe(1_005_000);
    expect(useTimeStore.getState().isLive()).toBe(true);
  });

  it('pauses, scales, jumps and steps continuously', () => {
    const t = useTimeStore.getState();
    t.pause();
    real += 10_000;
    expect(t.now()).toBe(1_000_000);
    t.resume();
    t.setRate(60);
    real += 1000;
    expect(useTimeStore.getState().now()).toBe(1_060_000);
    t.step(-60_000);
    expect(useTimeStore.getState().now()).toBe(1_000_000);
    t.jumpTo(5e12);
    expect(useTimeStore.getState().now()).toBe(5e12);
    expect(useTimeStore.getState().isLive()).toBe(false);
    t.resetToLive();
    expect(useTimeStore.getState().now()).toBe(real);
  });
});

describe('settings store', () => {
  it('defaults the elevation mask to 10 deg and clamps updates', () => {
    const s = useSettingsStore.getState();
    s.reset();
    expect(useSettingsStore.getState().elevationMaskDeg).toBe(10);
    s.update({ elevationMaskDeg: 120, autoRefreshHours: 0.5, passCount: Number.NaN });
    const next = useSettingsStore.getState();
    expect(next.elevationMaskDeg).toBe(89);
    expect(next.autoRefreshHours).toBe(2);
    expect(next.passCount).toBe(DEFAULT_SETTINGS.passCount);
  });
});

describe('observer store', () => {
  it('rejects invalid locations and keeps the previous one', () => {
    const o = useObserverStore.getState();
    o.resetLocation();
    const errors = o.setLocation({ latitudeDeg: 95, longitudeDeg: 0, altitudeM: 0, source: 'manual' });
    expect(errors.latitudeDeg).toBeDefined();
    expect(useObserverStore.getState().location).toEqual(DEFAULT_OBSERVER);
    expect(o.setLocation({ latitudeDeg: 40, longitudeDeg: -105, altitudeM: 1600, source: 'manual' })).toEqual({});
    expect(useObserverStore.getState().location.latitudeDeg).toBe(40);
  });
});

describe('satellite store', () => {
  beforeEach(async () => {
    setCatalogService(
      createSatelliteCatalog({
        cache: createMemoryStore(),
        fetchImpl: async (input) => new Response(String(input).includes('CATNR=5') ? VANGUARD : ISS),
        logger: { info: () => {}, warn: () => {} },
      }),
    );
    useSatelliteStore.setState({ enabledGroups: ['stations'], extraNoradIds: [], removedIds: [], trackedIds: [], trackedOnly: false, selectedId: null });
    await useSatelliteStore.getState().loadCatalog();
  });

  it('loads the catalog and derives active/visible sets', () => {
    const s = useSatelliteStore.getState();
    expect(s.loadState).toBe('ready');
    expect(s.active.map((x) => x.noradId)).toEqual([25544]);
    s.setCategoryVisible('iss', false);
    expect(useSatelliteStore.getState().visible).toHaveLength(0);
    s.setCategoryVisible('iss', true);
  });

  it('selects, clears the pass on selection change, and removes', () => {
    const s = useSatelliteStore.getState();
    s.select(25544);
    s.selectPass('25544-123');
    expect(selectSelectedSatellite(useSatelliteStore.getState())?.name).toBe('ISS (ZARYA)');
    s.select(null);
    expect(useSatelliteStore.getState().selectedPassId).toBeNull();
    s.select(25544);
    s.removeObject(25544);
    const after = useSatelliteStore.getState();
    expect(after.active).toHaveLength(0);
    expect(after.selectedId).toBeNull();
  });

  it('downloads objects added by NORAD id outside the enabled groups', async () => {
    useSatelliteStore.getState().addNoradId(5);
    expect(useSatelliteStore.getState().extraNoradIds).toEqual([5]);
    await useSatelliteStore.getState().loadCatalog();
    expect(useSatelliteStore.getState().active.map((x) => x.noradId).sort((a, b) => a - b)).toEqual([5, 25544]);
  });

  it('keeps a Tracked list separate from the catalog and filters the globe to it', async () => {
    const s = useSatelliteStore.getState();
    s.addTracked(25544);
    s.addTracked(25544); // no duplicates
    expect(useSatelliteStore.getState().trackedIds).toEqual([25544]);
    expect(useSatelliteStore.getState().trackedRecords.map((r) => r.noradId)).toEqual([25544]);

    // Adding an object that is not loaded downloads it, like addNoradId.
    s.addTracked(5);
    expect(useSatelliteStore.getState().extraNoradIds).toEqual([5]);
    await useSatelliteStore.getState().loadCatalog();
    expect(useSatelliteStore.getState().trackedRecords.map((r) => r.noradId)).toEqual([25544, 5]);

    s.removeTracked(5);
    s.setTrackedOnly(true);
    expect(useSatelliteStore.getState().visible.map((r) => r.noradId)).toEqual([25544]);
    // The catalog itself is unchanged.
    expect(useSatelliteStore.getState().active.map((r) => r.noradId).sort((a, b) => a - b)).toEqual([5, 25544]);
    s.setTrackedOnly(false);
    expect(useSatelliteStore.getState().visible).toHaveLength(2);
  });

  it('drops an object from the Tracked list when it is removed from the catalog', () => {
    const s = useSatelliteStore.getState();
    s.addTracked(25544);
    s.removeObject(25544);
    expect(useSatelliteStore.getState().trackedIds).toEqual([]);
    // Tracking it again restores it to the catalog.
    s.addTracked(25544);
    expect(useSatelliteStore.getState().removedIds).toEqual([]);
    expect(useSatelliteStore.getState().trackedRecords.map((r) => r.noradId)).toEqual([25544]);
  });

  it('selects a satellite and its pass together', () => {
    const s = useSatelliteStore.getState();
    s.select(null);
    s.selectSatellitePass(25544, '25544-1');
    expect(useSatelliteStore.getState()).toMatchObject({ selectedId: 25544, selectedPassId: '25544-1' });
  });
});
