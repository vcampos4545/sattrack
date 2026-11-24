import { describe, expect, it } from 'vitest';
import { parseTlePair } from '../../core/orbit/tle-parser';
import { catalogReloadDue, ERROR_RETRY_MS, summarizeCatalogHealth, type CatalogHealthInput } from '../../services/catalog-health';
import type { CatalogGroupStatus, SatelliteRecord } from '../../types/satellite';

const ISS_TLE = parseTlePair(
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
);
const sat: SatelliteRecord = { noradId: 25544, name: 'ISS (ZARYA)', category: 'iss', groups: ['stations'], tle: ISS_TLE };
const DAY = 86_400_000;
const HOUR = 3_600_000;
const epoch = ISS_TLE.epochMs;

const group = (patch: Partial<CatalogGroupStatus> = {}): CatalogGroupStatus => ({
  groupId: 'stations',
  source: 'network',
  fetchedAtMs: epoch + HOUR,
  recordCount: 1,
  rejectedCount: 0,
  error: null,
  ...patch,
});

const input = (patch: Partial<CatalogHealthInput> = {}): CatalogHealthInput => ({
  satellites: [sat],
  groupStatus: [group()],
  loadState: 'ready',
  loadError: null,
  simTimeMs: epoch + DAY,
  wallNowMs: epoch + 3 * HOUR,
  ...patch,
});

describe('summarizeCatalogHealth', () => {
  it('is ok for freshly downloaded data near its epoch', () => {
    const h = summarizeCatalogHealth(input());
    expect(h.level).toBe('ok');
    expect(h.headline).toBeNull();
    expect(h.dataAgeMs).toBe(2 * HOUR);
    expect(h.epochCounts).toEqual({ fresh: 1, aging: 0, stale: 0 });
  });

  it('measures epoch age against simulation time, not the download time', () => {
    // Downloaded moments ago, but the time controls are 20 days ahead of the epoch.
    const h = summarizeCatalogHealth(input({ simTimeMs: epoch + 20 * DAY }));
    expect(h.epochCounts.stale).toBe(1);
    expect(h.level).toBe('warn');
    expect(h.headline).toMatch(/14\+ days/);
    // Going backwards in time is flagged the same way.
    expect(summarizeCatalogHealth(input({ simTimeMs: epoch - 5 * DAY })).epochCounts.aging).toBe(1);
  });

  it('flags cached data served after a failed refresh as offline, with the data age', () => {
    const h = summarizeCatalogHealth(
      input({ groupStatus: [group({ source: 'cache', error: 'CelesTrak unreachable: fetch failed', fetchedAtMs: epoch })], wallNowMs: epoch + 30 * HOUR }),
    );
    expect(h.level).toBe('warn');
    expect(h.servingCacheAfterError).toBe(true);
    expect(h.dataAgeMs).toBe(30 * HOUR);
    expect(h.failedSources).toEqual([{ label: 'group stations', error: 'CelesTrak unreachable: fetch failed', source: 'cache' }]);
  });

  it('is an error with an offline-specific message when nothing could be loaded', () => {
    const base = input({ satellites: [], groupStatus: [group({ source: 'none', error: 'x', fetchedAtMs: null, recordCount: 0 })], loadState: 'error', loadError: 'No satellite data available' });
    expect(summarizeCatalogHealth(base).headline).toBe('No satellite data available');
    const offline = summarizeCatalogHealth({ ...base, browserOnline: false });
    expect(offline.level).toBe('error');
    expect(offline.headline).toMatch(/Offline and no cached/);
    expect(offline.dataAgeMs).toBeNull();
  });

  it('reports failed individual NORAD downloads and rejected records', () => {
    const h = summarizeCatalogHealth(
      input({
        groupStatus: [group({ rejectedCount: 3 })],
        extraStatus: [{ noradId: 99999, source: 'none', fetchedAtMs: null, error: 'CelesTrak returned no GP data' }],
      }),
    );
    expect(h.level).toBe('warn');
    expect(h.rejectedCount).toBe(3);
    expect(h.failedSources[0]!.label).toBe('NORAD 99999');
  });
});

describe('catalogReloadDue', () => {
  const base = { nowMs: 10 * DAY, lastLoadedAtMs: 10 * DAY - HOUR, loading: false, hadErrors: false, autoRefreshHours: 12 };

  it('waits for the auto-refresh interval when the last load was clean', () => {
    expect(catalogReloadDue(base)).toBe(false);
    expect(catalogReloadDue({ ...base, lastLoadedAtMs: base.nowMs - 12 * HOUR })).toBe(true);
  });

  it('retries sooner after errors, but not in a tight loop', () => {
    expect(catalogReloadDue({ ...base, hadErrors: true, lastLoadedAtMs: base.nowMs - ERROR_RETRY_MS + 1 })).toBe(false);
    expect(catalogReloadDue({ ...base, hadErrors: true, lastLoadedAtMs: base.nowMs - ERROR_RETRY_MS })).toBe(true);
  });

  it('never overlaps a running load and always loads when nothing was loaded', () => {
    expect(catalogReloadDue({ ...base, loading: true, lastLoadedAtMs: null })).toBe(false);
    expect(catalogReloadDue({ ...base, lastLoadedAtMs: null })).toBe(true);
  });
});
