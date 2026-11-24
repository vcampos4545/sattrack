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
    useSatelliteStore.setState({ enabledGroups: ['stations'], extraNoradIds: [], untrackedIds: [], selectedId: null });
    await useSatelliteStore.getState().loadCatalog();
  });

  it('loads the catalog and derives tracked/visible sets', () => {
    const s = useSatelliteStore.getState();
    expect(s.loadState).toBe('ready');
    expect(s.tracked.map((x) => x.noradId)).toEqual([25544]);
    s.setCategoryVisible('iss', false);
    expect(useSatelliteStore.getState().visible).toHaveLength(0);
    s.setCategoryVisible('iss', true);
  });

  it('selects, clears the pass on selection change, and untracks', () => {
    const s = useSatelliteStore.getState();
    s.select(25544);
    s.selectPass('25544-123');
    expect(selectSelectedSatellite(useSatelliteStore.getState())?.name).toBe('ISS (ZARYA)');
    s.select(null);
    expect(useSatelliteStore.getState().selectedPassId).toBeNull();
    s.select(25544);
    s.untrack(25544);
    const after = useSatelliteStore.getState();
    expect(after.tracked).toHaveLength(0);
    expect(after.selectedId).toBeNull();
  });

  it('downloads objects tracked by NORAD id outside the enabled groups', async () => {
    useSatelliteStore.getState().trackNoradId(5);
    expect(useSatelliteStore.getState().extraNoradIds).toEqual([5]);
    await useSatelliteStore.getState().loadCatalog();
    expect(useSatelliteStore.getState().tracked.map((x) => x.noradId).sort((a, b) => a - b)).toEqual([5, 25544]);
  });
});
