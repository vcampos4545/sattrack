/**
 * Satellite catalog service: download, validate, cache and merge GP data.
 *
 * Load policy, per source (a CelesTrak group or a single NORAD id):
 * 1. Read the cached TLE text and its download time from the cache store.
 * 2. Use the cache as-is when it is younger than `maxAgeMs` (the user's
 *    auto-refresh interval). This is what keeps app launches from
 *    re-downloading anything.
 * 3. Otherwise download. `force` (manual refresh) skips step 2 but still
 *    honors CelesTrak's 2-hour floor (`CELESTRAK_MIN_REFETCH_MS`).
 * 4. If the download fails, fall back to the cached copy (offline mode) and
 *    report the error alongside it. Without a cache the source is empty.
 *
 * Freshness here is measured with the wall clock (`wallClock`), never the
 * simulation clock: it is about when data was downloaded, not about which
 * instant is being displayed.
 *
 * Every record passes `parseTleText` validation and SGP4 initialization
 * before it is returned; rejects are counted, logged and dropped.
 *
 * Concurrent loads of the same source share one in-flight request, so
 * overlapping callers (React StrictMode double effects, a group toggled while
 * a load runs) never download the same data twice.
 */
import { createSatrec } from '../core/orbit/sgp4';
import { parseTleText } from '../core/orbit/tle-parser';
import {
  CATEGORY_PRIORITY,
  type CatalogGroupId,
  type CatalogGroupStatus,
  type CatalogSource,
  type SatelliteCategory,
  type SatelliteRecord,
  type TleRecord,
} from '../types/satellite';
import {
  CELESTRAK_MIN_REFETCH_MS,
  catalogNumberUrl,
  fetchTleText,
  getGroupDefinition,
  groupUrl,
} from './celestrak';
import type { KeyValueStore } from './storage';

/** NORAD id of the ISS (ZARYA), given its own category. */
export const ISS_NORAD_ID = 25544;

export interface CachedTleText {
  text: string;
  /** Wall-clock UTC ms of the download. */
  fetchedAtMs: number;
}

export interface CatalogLoadOptions {
  groups: readonly CatalogGroupId[];
  /** Individually tracked objects outside the enabled groups. */
  extraNoradIds?: readonly number[];
  /** Cached data younger than this is used without downloading, ms. */
  maxAgeMs: number;
  /** Manual refresh: download anything older than CelesTrak's 2-hour floor. */
  force?: boolean;
  signal?: AbortSignal;
}

export interface ExtraObjectStatus {
  noradId: number;
  source: CatalogSource;
  fetchedAtMs: number | null;
  error: string | null;
}

export interface CatalogLoadResult {
  satellites: SatelliteRecord[];
  groupStatus: CatalogGroupStatus[];
  extraStatus: ExtraObjectStatus[];
  /** Wall-clock ms when this load finished. */
  loadedAtMs: number;
}

export interface CatalogLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

export interface SatelliteCatalogDeps {
  cache: KeyValueStore;
  fetchImpl?: typeof fetch;
  wallClock?: () => number;
  logger?: CatalogLogger;
}

export interface SatelliteCatalog {
  load(opts: CatalogLoadOptions): Promise<CatalogLoadResult>;
}

export const groupCacheKey = (id: CatalogGroupId) => `tle:group:${id}`;
export const catalogNumberCacheKey = (id: number) => `tle:catnr:${id}`;

interface SourceResult {
  records: TleRecord[];
  rejectedCount: number;
  source: CatalogSource;
  fetchedAtMs: number | null;
  error: string | null;
}

function pickCategory(noradId: number, groups: Iterable<CatalogGroupId>): SatelliteCategory {
  if (noradId === ISS_NORAD_ID) return 'iss';
  const cats = new Set<SatelliteCategory>();
  for (const g of groups) cats.add(getGroupDefinition(g).category);
  return CATEGORY_PRIORITY.find((c) => cats.has(c)) ?? 'other';
}

export function createSatelliteCatalog(deps: SatelliteCatalogDeps): SatelliteCatalog {
  const wallClock = deps.wallClock ?? (() => Date.now());
  const log: CatalogLogger = deps.logger ?? {
    info: (m, ...a) => console.info(`[catalog] ${m}`, ...a),
    warn: (m, ...a) => console.warn(`[catalog] ${m}`, ...a),
  };

  /** Parses text and drops records SGP4 cannot initialize. */
  function parseAndValidate(label: string, text: string): { records: TleRecord[]; rejectedCount: number } {
    const { records, errors } = parseTleText(text);
    const valid: TleRecord[] = [];
    let rejected = errors.length;
    for (const e of errors) log.warn(`${label}: line ${e.line}: ${e.message}`);
    for (const r of records) {
      try {
        createSatrec(r);
        valid.push(r);
      } catch (err) {
        rejected++;
        log.warn(`${label}: ${r.name} (${r.noradId}) rejected: ${(err as Error).message}`);
      }
    }
    return { records: valid, rejectedCount: rejected };
  }

  const inflight = new Map<string, Promise<SourceResult>>();

  function loadSource(label: string, key: string, url: string, opts: CatalogLoadOptions): Promise<SourceResult> {
    const flightKey = `${key}|${opts.force ? 'force' : opts.maxAgeMs}`;
    let promise = inflight.get(flightKey);
    if (!promise) {
      promise = loadSourceUncached(label, key, url, opts).finally(() => inflight.delete(flightKey));
      inflight.set(flightKey, promise);
    }
    return promise;
  }

  async function loadSourceUncached(
    label: string,
    key: string,
    url: string,
    opts: CatalogLoadOptions,
  ): Promise<SourceResult> {
    const now = wallClock();
    let cached: CachedTleText | undefined;
    try {
      cached = await deps.cache.get<CachedTleText>(key);
    } catch (err) {
      log.warn(`${label}: cache read failed`, err);
    }
    const age = cached ? now - cached.fetchedAtMs : Number.POSITIVE_INFINITY;
    const shouldFetch = opts.force ? age >= CELESTRAK_MIN_REFETCH_MS : age >= opts.maxAgeMs;

    if (shouldFetch) {
      try {
        const text = await fetchTleText(url, { fetchImpl: deps.fetchImpl, signal: opts.signal });
        const parsed = parseAndValidate(label, text);
        if (parsed.records.length === 0) throw new Error('download contained no valid element sets');
        const entry: CachedTleText = { text, fetchedAtMs: wallClock() };
        try {
          await deps.cache.set(key, entry);
        } catch (err) {
          log.warn(`${label}: cache write failed`, err);
        }
        log.info(`${label}: downloaded ${parsed.records.length} element sets`);
        return { ...parsed, source: 'network', fetchedAtMs: entry.fetchedAtMs, error: null };
      } catch (err) {
        const message = (err as Error).message;
        if (cached) {
          log.warn(`${label}: refresh failed, using cached data: ${message}`);
          return { ...parseAndValidate(label, cached.text), source: 'cache', fetchedAtMs: cached.fetchedAtMs, error: message };
        }
        log.warn(`${label}: no data available: ${message}`);
        return { records: [], rejectedCount: 0, source: 'none', fetchedAtMs: null, error: message };
      }
    }
    // shouldFetch is false only when a cached entry exists.
    const entry = cached as CachedTleText;
    return { ...parseAndValidate(label, entry.text), source: 'cache', fetchedAtMs: entry.fetchedAtMs, error: null };
  }

  return {
    async load(opts) {
      const groupIds = [...new Set(opts.groups)];
      const extraIds = [...new Set(opts.extraNoradIds ?? [])];
      const [groupResults, extraResults] = await Promise.all([
        Promise.all(groupIds.map((id) => loadSource(`group ${id}`, groupCacheKey(id), groupUrl(id), opts))),
        Promise.all(
          extraIds.map((id) => loadSource(`NORAD ${id}`, catalogNumberCacheKey(id), catalogNumberUrl(id), opts)),
        ),
      ]);

      // Merge by NORAD id. When sources disagree, keep the newest epoch.
      const merged = new Map<number, { tle: TleRecord; groups: Set<CatalogGroupId> }>();
      const add = (tle: TleRecord, group: CatalogGroupId | null) => {
        const existing = merged.get(tle.noradId);
        if (!existing) {
          merged.set(tle.noradId, { tle, groups: new Set(group ? [group] : []) });
          return;
        }
        if (group) existing.groups.add(group);
        if (tle.epochMs > existing.tle.epochMs) existing.tle = tle;
      };
      groupResults.forEach((r, i) => r.records.forEach((tle) => add(tle, groupIds[i]!)));
      extraResults.forEach((r) => r.records.forEach((tle) => add(tle, null)));

      const satellites: SatelliteRecord[] = [...merged.values()]
        .map(({ tle, groups }) => ({
          noradId: tle.noradId,
          name: tle.name,
          category: pickCategory(tle.noradId, groups),
          groups: [...groups],
          tle,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        satellites,
        groupStatus: groupResults.map((r, i) => ({
          groupId: groupIds[i]!,
          source: r.source,
          fetchedAtMs: r.fetchedAtMs,
          recordCount: r.records.length,
          rejectedCount: r.rejectedCount,
          error: r.error,
        })),
        extraStatus: extraResults.map((r, i) => ({
          noradId: extraIds[i]!,
          source: r.source,
          fetchedAtMs: r.fetchedAtMs,
          error: r.error,
        })),
        loadedAtMs: wallClock(),
      };
    },
  };
}
