/**
 * Catalog health: one summary of how trustworthy the loaded orbital data is,
 * shared by the header status, the notice banner and the settings panel.
 *
 * Two different ages are involved and must not be mixed up:
 * - Data age (wall clock): how long ago the element sets were downloaded.
 *   This drives "offline, cached" and refresh messaging.
 * - Epoch age (simulation time): how far the displayed instant is from each
 *   element set's epoch. SGP4 error grows with it, so it drives the
 *   "aging" / "stale" warnings even for freshly downloaded data (for example
 *   when the time controls jump a year ahead).
 *
 * Pure: no React, no stores, no clock. Callers pass both times in.
 */
import { classifyEpochAge } from '../core/orbit/time-utils';
import type { CatalogGroupStatus, SatelliteRecord } from '../types/satellite';
import type { ExtraObjectStatus } from './satellite-catalog';

export type HealthLevel = 'ok' | 'warn' | 'error';

export interface CatalogHealthInput {
  satellites: readonly SatelliteRecord[];
  groupStatus: readonly CatalogGroupStatus[];
  extraStatus?: readonly ExtraObjectStatus[];
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  loadError: string | null;
  /** Simulation time, UTC ms (epoch age is measured against this). */
  simTimeMs: number;
  /** Wall-clock time, UTC ms (data age is measured against this). */
  wallNowMs: number;
  /** `navigator.onLine`; false only when the browser knows it is offline. */
  browserOnline?: boolean;
}

export interface CatalogHealth {
  level: HealthLevel;
  /** Wall-clock ms of the oldest download in use, or null if nothing was ever downloaded. */
  oldestFetchMs: number | null;
  /** Wall-clock age of the oldest download in use, ms. */
  dataAgeMs: number | null;
  /** At least one source failed to refresh and is being served from cache. */
  servingCacheAfterError: boolean;
  /** Sources (groups and individual NORAD ids) whose last load reported an error. */
  failedSources: { label: string; error: string; source: CatalogGroupStatus['source'] }[];
  /** Records rejected by TLE validation or SGP4 initialization. */
  rejectedCount: number;
  /** Element sets by epoch age at the simulation time. */
  epochCounts: { fresh: number; aging: number; stale: number };
  /** One-line human summary for the most important problem, or null when healthy. */
  headline: string | null;
}

export function summarizeCatalogHealth(input: CatalogHealthInput): CatalogHealth {
  const fetched = input.groupStatus.map((g) => g.fetchedAtMs).filter((t): t is number => t !== null);
  const oldestFetchMs = fetched.length ? Math.min(...fetched) : null;

  const failedSources: CatalogHealth['failedSources'] = [
    ...input.groupStatus
      .filter((g) => g.error)
      .map((g) => ({ label: `group ${g.groupId}`, error: g.error as string, source: g.source })),
    ...(input.extraStatus ?? [])
      .filter((e) => e.error)
      .map((e) => ({ label: `NORAD ${e.noradId}`, error: e.error as string, source: e.source })),
  ];
  const servingCacheAfterError = failedSources.some((f) => f.source === 'cache');

  const epochCounts = { fresh: 0, aging: 0, stale: 0 };
  for (const s of input.satellites) epochCounts[classifyEpochAge(s.tle.epochMs, input.simTimeMs)]++;

  const rejectedCount = input.groupStatus.reduce((n, g) => n + g.rejectedCount, 0);
  const empty = input.satellites.length === 0;
  const offlineBrowser = input.browserOnline === false;

  let level: HealthLevel = 'ok';
  let headline: string | null = null;
  if (input.loadState === 'error' || (empty && input.loadState === 'ready')) {
    level = 'error';
    const cause = failedSources[0]?.error;
    headline = offlineBrowser
      ? 'Offline and no cached orbital data yet. Connect once to download element sets from CelesTrak.'
      : cause
        ? `No orbital data loaded: ${cause}. Nothing is cached yet to fall back on.`
        : (input.loadError ?? 'No orbital data could be loaded.');
  } else if (servingCacheAfterError) {
    level = 'warn';
    headline = 'CelesTrak could not be reached. Showing cached element sets.';
  } else if (failedSources.length > 0) {
    level = 'warn';
    headline = `${failedSources.length} source${failedSources.length === 1 ? '' : 's'} failed to load.`;
  } else if (!empty && epochCounts.stale === input.satellites.length) {
    // Every element set is far from the displayed time: almost always the
    // time controls are set far from the epoch, or the cache is very old.
    level = 'warn';
    headline = 'All element sets are 14+ days from the displayed time. Positions may be off by tens of km or more.';
  }

  return {
    level,
    oldestFetchMs,
    dataAgeMs: oldestFetchMs === null ? null : Math.max(0, input.wallNowMs - oldestFetchMs),
    servingCacheAfterError,
    failedSources,
    rejectedCount,
    epochCounts,
    headline,
  };
}

/** After a failed download, retry this soon instead of waiting a full refresh interval. */
export const ERROR_RETRY_MS = 15 * 60 * 1000;

/**
 * Whether a background (non-forced) catalog load is due. Pure so it can be
 * tested; times are wall-clock ms because data age is about real downloads,
 * not simulation time.
 */
export function catalogReloadDue(opts: {
  nowMs: number;
  lastLoadedAtMs: number | null;
  loading: boolean;
  hadErrors: boolean;
  autoRefreshHours: number;
}): boolean {
  if (opts.loading) return false;
  if (opts.lastLoadedAtMs === null) return true;
  const since = opts.nowMs - opts.lastLoadedAtMs;
  return since >= opts.autoRefreshHours * 3_600_000 || (opts.hadErrors && since >= ERROR_RETRY_MS);
}
