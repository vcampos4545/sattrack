/**
 * Predicted passes of the selected satellite over the observer, shared by the
 * passes table and the sky plot. Written only by `services/pass-scheduler.ts`;
 * read it through `usePassPredictions()` / `useSelectedPass()` so the
 * scheduler is running while anything displays passes.
 */
import { create } from 'zustand';
import type { PassSearchResult } from '../core/orbit/pass-prediction';
import type { Pass } from '../types/passes';

export type PassComputeState = 'idle' | 'computing' | 'ready' | 'error';

export interface PassStoreState {
  /** `idle`: nothing selected. `computing`: no result yet for the current inputs. */
  state: PassComputeState;
  /** Satellite the current result belongs to. */
  noradId: number | null;
  /** Full search result (status, window, diagnostics). Null while computing for new inputs. */
  result: PassSearchResult | null;
  /** `result.passes`, or empty. Stable reference between results. */
  passes: Pass[];
  /** True while a time-driven recompute runs; `passes` are still valid meanwhile. */
  refreshing: boolean;
  /** Worker or SGP4 initialization failure. */
  error: string | null;
  /** Duration of the last search, ms. */
  computeMs: number | null;
}

export const INITIAL_PASS_STATE: PassStoreState = {
  state: 'idle',
  noradId: null,
  result: null,
  passes: [],
  refreshing: false,
  error: null,
  computeMs: null,
};

export const usePassStore = create<PassStoreState>()(() => ({ ...INITIAL_PASS_STATE }));

/** The pass with `selectedPassId` among the current passes, or null. */
export function findPass(passes: readonly Pass[], passId: string | null): Pass | null {
  if (passId === null) return null;
  return passes.find((p) => p.id === passId) ?? null;
}
