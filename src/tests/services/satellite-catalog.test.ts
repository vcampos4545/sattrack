import { describe, expect, it, vi } from 'vitest';
import { CELESTRAK_MIN_REFETCH_MS, CelestrakError, fetchTleText, groupUrl } from '../../services/celestrak';
import { createSatelliteCatalog, groupCacheKey, type CachedTleText } from '../../services/satellite-catalog';
import { createMemoryStore, withMemoryFallback, type KeyValueStore } from '../../services/storage';

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
const BROKEN = ['BROKEN', '1 99999U', '2 99999'].join('\n');

const HOUR = 3_600_000;
const silent = { info: () => {}, warn: () => {} };

function okResponse(text: string) {
  return new Response(text, { status: 200, headers: { 'content-type': 'text/plain' } });
}

function setup(opts: { now?: number; fetchImpl?: typeof fetch; cache?: KeyValueStore } = {}) {
  let now = opts.now ?? 1_800_000_000_000;
  const cache = opts.cache ?? createMemoryStore();
  const fetchImpl = vi.fn(opts.fetchImpl ?? (async () => okResponse(`${ISS}\n${VANGUARD}\n${BROKEN}\n`)));
  const catalog = createSatelliteCatalog({ cache, fetchImpl, wallClock: () => now, logger: silent });
  return { catalog, cache, fetchImpl, advance: (ms: number) => (now += ms), now: () => now };
}

describe('satellite catalog service', () => {
  it('downloads, validates, caches and categorizes on first load', async () => {
    const { catalog, cache, fetchImpl, now } = setup();
    const result = await catalog.load({ groups: ['stations'], maxAgeMs: 12 * HOUR });
    expect(fetchImpl).toHaveBeenCalledWith(groupUrl('stations'), expect.anything());
    expect(result.satellites.map((s) => [s.name, s.category])).toEqual([
      ['ISS (ZARYA)', 'iss'],
      ['VANGUARD 1', 'stations'],
    ]);
    expect(result.groupStatus[0]).toMatchObject({ source: 'network', recordCount: 2, rejectedCount: 1, error: null });
    const cached = await cache.get<CachedTleText>(groupCacheKey('stations'));
    expect(cached?.fetchedAtMs).toBe(now());
  });

  it('serves fresh cache on later launches without downloading', async () => {
    const { catalog, fetchImpl, advance } = setup();
    await catalog.load({ groups: ['stations'], maxAgeMs: 12 * HOUR });
    advance(6 * HOUR);
    const result = await catalog.load({ groups: ['stations'], maxAgeMs: 12 * HOUR });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.groupStatus[0]?.source).toBe('cache');
    expect(result.satellites).toHaveLength(2);
  });

  it('refreshes when the cache is older than maxAge', async () => {
    const { catalog, fetchImpl, advance } = setup();
    await catalog.load({ groups: ['stations'], maxAgeMs: 12 * HOUR });
    advance(13 * HOUR);
    await catalog.load({ groups: ['stations'], maxAgeMs: 12 * HOUR });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('honors the CelesTrak 2-hour floor on manual refresh', async () => {
    const { catalog, fetchImpl, advance } = setup();
    await catalog.load({ groups: ['stations'], maxAgeMs: 12 * HOUR });
    advance(CELESTRAK_MIN_REFETCH_MS - 1);
    await catalog.load({ groups: ['stations'], maxAgeMs: 12 * HOUR, force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(1);
    await catalog.load({ groups: ['stations'], maxAgeMs: 12 * HOUR, force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falls back to cached data when offline and reports the error', async () => {
    let online = true;
    const { catalog, advance } = setup({
      fetchImpl: async () => {
        if (!online) throw new TypeError('Failed to fetch');
        return okResponse(ISS);
      },
    });
    await catalog.load({ groups: ['stations'], maxAgeMs: HOUR });
    online = false;
    advance(5 * HOUR);
    const result = await catalog.load({ groups: ['stations'], maxAgeMs: HOUR });
    expect(result.satellites).toHaveLength(1);
    expect(result.groupStatus[0]).toMatchObject({ source: 'cache' });
    expect(result.groupStatus[0]?.error).toMatch(/unreachable/);
  });

  it('reports an empty source when offline with no cache', async () => {
    const { catalog } = setup({ fetchImpl: async () => new Response('', { status: 503 }) });
    const result = await catalog.load({ groups: ['weather'], maxAgeMs: HOUR });
    expect(result.satellites).toHaveLength(0);
    expect(result.groupStatus[0]).toMatchObject({ source: 'none', recordCount: 0 });
    expect(result.groupStatus[0]?.error).toMatch(/HTTP 503/);
  });

  it('merges objects present in several groups and loads extra NORAD ids', async () => {
    const { catalog, fetchImpl } = setup({
      fetchImpl: async (input) => okResponse(String(input).includes('CATNR=5') ? VANGUARD : ISS),
    });
    const result = await catalog.load({ groups: ['stations', 'amateur'], extraNoradIds: [5], maxAgeMs: HOUR });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const iss = result.satellites.find((s) => s.noradId === 25544);
    expect(iss?.groups.sort()).toEqual(['amateur', 'stations']);
    const vanguard = result.satellites.find((s) => s.noradId === 5);
    expect(vanguard).toMatchObject({ category: 'other', groups: [] });
    expect(result.extraStatus).toEqual([{ noradId: 5, source: 'network', fetchedAtMs: expect.any(Number), error: null }]);
  });

  it('shares one download between concurrent loads of the same group', async () => {
    const { catalog, fetchImpl } = setup();
    const [a, b] = await Promise.all([
      catalog.load({ groups: ['stations'], maxAgeMs: HOUR }),
      catalog.load({ groups: ['stations', 'weather'], maxAgeMs: HOUR }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // stations once, weather once
    expect(a.satellites).toHaveLength(2);
    expect(b.groupStatus.map((g) => g.groupId)).toEqual(['stations', 'weather']);
  });

  it('keeps working when the cache store itself fails', async () => {
    const failing: KeyValueStore = {
      get: async () => {
        throw new Error('disk on fire');
      },
      set: async () => {
        throw new Error('disk on fire');
      },
      delete: async () => {},
    };
    const { catalog } = setup({ cache: withMemoryFallback(failing) });
    const result = await catalog.load({ groups: ['stations'], maxAgeMs: HOUR });
    expect(result.satellites).toHaveLength(2);
  });
});

describe('fetchTleText', () => {
  it('maps CelesTrak responses to typed errors', async () => {
    const run = (res: Response | Error) =>
      fetchTleText('https://example.invalid', {
        fetchImpl: async () => {
          if (res instanceof Error) throw res;
          return res;
        },
      });
    await expect(run(new Response('No GP data found', { status: 200 }))).rejects.toMatchObject({ kind: 'empty' });
    await expect(run(new Response('Forbidden', { status: 403 }))).rejects.toMatchObject({ kind: 'http', status: 403 });
    await expect(run(new TypeError('offline'))).rejects.toBeInstanceOf(CelestrakError);
    await expect(run(okResponse(ISS))).resolves.toContain('ZARYA');
  });

  it('times out slow requests', async () => {
    const never: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(fetchTleText('https://example.invalid', { fetchImpl: never, timeoutMs: 10 })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });
});
