/**
 * Combined pass schedule for the Tracked list: the pure merge, and the
 * scheduler end to end (no Web Worker under Node, so searches run on the
 * main-thread fallback with the same code).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PassSearchResult } from '../../core/orbit/pass-prediction';
import { passSearchCount, retainPassScheduler } from '../../services/pass-scheduler';
import { createSatelliteCatalog } from '../../services/satellite-catalog';
import { createMemoryStore } from '../../services/storage';
import { useObserverStore } from '../../stores/observer-store';
import { mergePassSchedule, usePassStore } from '../../stores/pass-store';
import { setCatalogService, useSatelliteStore } from '../../stores/satellite-store';
import { useSettingsStore } from '../../stores/settings-store';
import { setWallClock, useTimeStore } from '../../stores/time-store';
import type { Pass } from '../../types/passes';

const H = 3_600_000;

function pass(noradId: number, aosMs: number, losMs = aosMs + 0.2 * H): Pass {
  return {
    id: `${noradId}-${aosMs}`,
    noradId,
    elevationMaskDeg: 10,
    aosMs,
    aosAzimuthDeg: 0,
    losMs,
    losAzimuthDeg: 180,
    maxElevationMs: (aosMs + losMs) / 2,
    maxElevationDeg: 45,
    maxElevationAzimuthDeg: 90,
    durationS: (losMs - aosMs) / 1000,
    inProgressAtSearchStart: false,
    track: [],
  };
}

function result(noradId: number, passes: Pass[], scannedUntilMs: number, status: PassSearchResult['status'] = 'ok'): PassSearchResult {
  return {
    noradId,
    status,
    passes,
    searchStartMs: 0,
    windowEndMs: 7 * 24 * H,
    scannedUntilMs,
    elevationMaskDeg: 10,
    highestSampledElevationDeg: 45,
    evaluations: 0,
    propagationFailures: 0,
    error: status === 'propagation-error' ? 'decayed' : null,
  };
}

describe('mergePassSchedule', () => {
  it('merges passes of several satellites in AOS order', () => {
    const a = result(1, [pass(1, 1 * H), pass(1, 5 * H)], 7 * 24 * H);
    const b = result(2, [pass(2, 3 * H), pass(2, 4 * H)], 7 * 24 * H);
    const { passes, horizonMs } = mergePassSchedule([a, b]);
    expect(passes.map((p) => p.id)).toEqual(['1-3600000', '2-10800000', '2-14400000', '1-18000000']);
    expect(horizonMs).toBe(7 * 24 * H);
  });

  it('breaks AOS ties by NORAD id so the order is stable', () => {
    const { passes } = mergePassSchedule([result(9, [pass(9, H)], 10 * H), result(3, [pass(3, H)], 10 * H)]);
    expect(passes.map((p) => p.noradId)).toEqual([3, 9]);
  });

  it('cuts the list where the earliest search stopped, so no pass is skipped', () => {
    // Satellite 1 hit its pass limit at 6 h; satellite 2 was searched for 7 days.
    const frequent = result(1, [pass(1, 1 * H), pass(1, 5 * H, 6 * H)], 6 * H);
    const rare = result(2, [pass(2, 2 * H), pass(2, 30 * H)], 7 * 24 * H);
    const { passes, horizonMs } = mergePassSchedule([frequent, rare]);
    expect(horizonMs).toBe(6 * H);
    // The 30 h pass is dropped: satellite 1 may have unlisted passes before it.
    expect(passes.map((p) => p.aosMs)).toEqual([1 * H, 2 * H, 5 * H]);
  });

  it('ignores results that could not be propagated and handles empty input', () => {
    const broken = result(3, [], 0, 'propagation-error');
    const ok = result(1, [pass(1, H)], 7 * 24 * H);
    expect(mergePassSchedule([broken, ok]).horizonMs).toBe(7 * 24 * H);
    expect(mergePassSchedule([broken])).toEqual({ passes: [], horizonMs: null });
    expect(mergePassSchedule([])).toEqual({ passes: [], horizonMs: null });
  });

  it('keeps satellites that never rise in the horizon without adding passes', () => {
    const never = result(4, [], 7 * 24 * H, 'never-above-mask');
    const ok = result(1, [pass(1, H)], 12 * H);
    expect(mergePassSchedule([never, ok])).toMatchObject({ horizonMs: 12 * H, passes: [{ noradId: 1 }] });
  });
});

/** Appends the modulo-10 TLE checksum to a 68-character line. */
function withChecksum(line68: string): string {
  let sum = 0;
  for (const ch of line68) {
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return line68 + (sum % 10);
}

const ISS = [
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
];
/** Synthetic polar orbit with the same epoch as the ISS element set. */
const POLAR = [
  'TEST POLAR',
  withChecksum('1 99002U 19001A   19156.50900463  .00000050  00000-0  45000-4 0  999'),
  withChecksum('2 99002  98.7000 120.0000 0013000  90.0000 270.0000 14.1250000000001'),
];
const EPOCH_MS = Date.UTC(2019, 5, 5, 12, 13); // 2019 day 156.509

describe('pass scheduler with the Tracked list', () => {
  let release: () => void = () => {};

  beforeAll(async () => {
    setCatalogService(
      createSatelliteCatalog({
        cache: createMemoryStore(),
        fetchImpl: async () => new Response([...ISS, ...POLAR].join('\n')),
        logger: { info: () => {}, warn: () => {} },
      }),
    );
    setWallClock(() => EPOCH_MS);
    useTimeStore.getState().resetToLive();
    useTimeStore.getState().pause();
    useSettingsStore.getState().update({ passCount: 4, passSearchDays: 1, passScanStepS: 60, elevationMaskDeg: 10 });
    useObserverStore.getState().setLocation({ latitudeDeg: 40.015, longitudeDeg: -105.27, altitudeM: 1655, source: 'manual' });
    useSatelliteStore.setState({ enabledGroups: ['stations'], extraNoradIds: [], removedIds: [], trackedIds: [], trackedOnly: false, selectedId: null });
    await useSatelliteStore.getState().loadCatalog();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterAll(() => {
    release();
    useSettingsStore.getState().reset();
    useObserverStore.getState().resetLocation();
    useSatelliteStore.setState({ trackedIds: [], trackedOnly: false });
    useTimeStore.getState().resetToLive();
    vi.restoreAllMocks();
  });

  const settled = () =>
    vi.waitFor(
      () => {
        const p = usePassStore.getState();
        expect(p.pendingCount).toBe(0);
        expect(p.refreshing).toBe(false);
      },
      { timeout: 10_000, interval: 20 },
    );

  it('merges every tracked satellite into one AOS-sorted schedule', async () => {
    const sat = useSatelliteStore.getState();
    sat.addTracked(25544);
    sat.addTracked(99002);
    sat.setTrackedOnly(true);
    const before = passSearchCount();
    release = retainPassScheduler();
    await settled();

    const p = usePassStore.getState();
    expect(p.mode).toBe('tracked');
    expect(p.state).toBe('ready');
    expect(p.totalCount).toBe(2);
    expect([...p.results.keys()].sort()).toEqual([25544, 99002]);
    expect(passSearchCount() - before).toBe(2);
    expect(new Set(p.passes.map((x) => x.noradId))).toEqual(new Set([25544, 99002]));
    const aos = p.passes.map((x) => x.aosMs);
    expect(aos).toEqual([...aos].sort((a, b) => a - b));
    expect(p.passes.every((x) => x.aosMs <= p.horizonMs!)).toBe(true);
    // The globe shows only the tracked objects.
    expect(useSatelliteStore.getState().visible.map((r) => r.noradId).sort()).toEqual([25544, 99002]);
  });

  it('does not recompute on unrelated changes, and recomputes only what changed', async () => {
    const before = passSearchCount();
    const sat = useSatelliteStore.getState();
    sat.selectSatellitePass(25544, usePassStore.getState().passes[0]!.id);
    sat.setCategoryVisible('iss', false);
    sat.setCategoryVisible('iss', true);
    await settled();
    expect(passSearchCount()).toBe(before);
    expect(useSatelliteStore.getState().selectedId).toBe(25544);

    sat.removeTracked(99002);
    await settled();
    expect(passSearchCount()).toBe(before);
    expect([...usePassStore.getState().results.keys()]).toEqual([25544]);
    expect(usePassStore.getState().passes.every((x) => x.noradId === 25544)).toBe(true);

    sat.addTracked(99002);
    await settled();
    expect(passSearchCount()).toBe(before + 1);

    useSettingsStore.getState().update({ elevationMaskDeg: 20 });
    await settled();
    expect(passSearchCount()).toBe(before + 3);
  });

  it('falls back to the selected satellite when the filter is off, reusing its result', async () => {
    const before = passSearchCount();
    useSatelliteStore.getState().setTrackedOnly(false);
    await settled();
    const p = usePassStore.getState();
    expect(p.mode).toBe('selected');
    expect(p.noradId).toBe(25544);
    expect(p.result?.noradId).toBe(25544);
    expect(p.passes.every((x) => x.noradId === 25544)).toBe(true);
    expect(passSearchCount()).toBe(before);
  });
});
