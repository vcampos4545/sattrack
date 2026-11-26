/**
 * Predicted passes over the observer, shared by the passes table and the sky
 * plot. Written only by `services/pass-scheduler.ts`; read it through
 * `usePassPredictions()` / `useSelectedPass()` so the scheduler is running
 * while anything displays passes.
 *
 * Two modes, following the satellite store's `trackedOnly` filter:
 * - `selected`: passes of the selected satellite (`noradId`, `result`).
 * - `tracked`: the combined schedule of every Tracked-list satellite, merged
 *   and sorted by AOS (`passes`), with per-satellite results in `results`.
 */
import { create } from 'zustand';
import type { PassSearchResult } from '../core/orbit/pass-prediction';
import type { Pass } from '../types/passes';

export type PassComputeState = 'idle' | 'computing' | 'ready' | 'error';
export type PassScheduleMode = 'selected' | 'tracked';

export interface PassStoreState {
  mode: PassScheduleMode;
  /**
   * `idle`: nothing to predict (no selection, or an empty Tracked list).
   * `computing`: no result yet for the current inputs.
   * `error`: every search failed (see `error`).
   */
  state: PassComputeState;
  /** Selected mode: satellite the current result belongs to. Null in tracked mode. */
  noradId: number | null;
  /** Selected mode: full search result (status, window, diagnostics). Null while computing and in tracked mode. */
  result: PassSearchResult | null;
  /** Latest result for each satellite of the current inputs, by NORAD id. Both modes. */
  results: ReadonlyMap<number, PassSearchResult>;
  /**
   * Selected mode: `result.passes`. Tracked mode: the merged schedule up to
   * `horizonMs`, sorted by AOS. Stable reference between results.
   */
  passes: Pass[];
  /** Tracked mode: the merged schedule is complete for AOS before this time, UTC ms. */
  horizonMs: number | null;
  /** Satellites of the current inputs that still have no result. */
  pendingCount: number;
  /** Satellites of the current inputs. */
  totalCount: number;
  /** True while a time-driven recompute runs; `passes` are still valid meanwhile. */
  refreshing: boolean;
  /** Worker or SGP4 initialization failure (selected mode, or the first one in tracked mode). */
  error: string | null;
  /** Satellites whose search failed, with the message (tracked mode). */
  failures: ReadonlyMap<number, string>;
  /** Duration of the last search, ms. */
  computeMs: number | null;
}

export const INITIAL_PASS_STATE: PassStoreState = {
  mode: 'selected',
  state: 'idle',
  noradId: null,
  result: null,
  results: new Map(),
  passes: [],
  horizonMs: null,
  pendingCount: 0,
  totalCount: 0,
  refreshing: false,
  error: null,
  failures: new Map(),
  computeMs: null,
};

export const usePassStore = create<PassStoreState>()(() => ({ ...INITIAL_PASS_STATE }));

/** The pass with `selectedPassId` among the current passes, or null. */
export function findPass(passes: readonly Pass[], passId: string | null): Pass | null {
  if (passId === null) return null;
  return passes.find((p) => p.id === passId) ?? null;
}

/**
 * Merges per-satellite results into one schedule sorted by AOS (ties by NORAD
 * id). Each search stops after `maxPasses`, so a satellite with frequent
 * passes covers less time than one with rare passes. The merged list is cut
 * at the earliest `scannedUntilMs` (the horizon) so it never skips a pass of a
 * satellite whose search stopped early. Results with `propagation-error` have
 * no passes and do not limit the horizon. Pure; exported for tests.
 */
export function mergePassSchedule(results: Iterable<PassSearchResult>): { passes: Pass[]; horizonMs: number | null } {
  let horizonMs: number | null = null;
  const all: Pass[] = [];
  for (const r of results) {
    if (r.status === 'propagation-error') continue;
    horizonMs = horizonMs === null ? r.scannedUntilMs : Math.min(horizonMs, r.scannedUntilMs);
    all.push(...r.passes);
  }
  if (horizonMs === null) return { passes: [], horizonMs: null };
  const h = horizonMs;
  const passes = all.filter((p) => p.aosMs <= h).sort((a, b) => a.aosMs - b.aosMs || a.noradId - b.noradId);
  return { passes, horizonMs };
}
