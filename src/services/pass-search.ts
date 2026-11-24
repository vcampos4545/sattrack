/**
 * Serializable pass-search job, shared by the Web Worker and the main-thread
 * fallback. Only plain data crosses the worker boundary: the TLE lines, not a
 * satellite.js SatRec.
 */
import { predictPasses, type PassSearchOptions, type PassSearchResult } from '../core/orbit/pass-prediction';
import { createSatrec } from '../core/orbit/sgp4';
import type { ObserverLocation } from '../types/observer';

export interface PassSearchRequest {
  /** Request sequence number; responses echo it so stale results can be dropped. */
  id: number;
  noradId: number;
  line1: string;
  line2: string;
  observer: ObserverLocation;
  options: PassSearchOptions;
}

export type PassSearchResponse =
  | { id: number; ok: true; result: PassSearchResult; computeMs: number }
  | { id: number; ok: false; error: string };

/** Runs one search synchronously. Never throws; errors come back as `ok: false`. */
export function runPassSearch(req: PassSearchRequest): PassSearchResponse {
  const started = performance.now();
  try {
    const satrec = createSatrec(req);
    const result = predictPasses(satrec, req.observer, req.options, req.noradId);
    return { id: req.id, ok: true, result, computeMs: performance.now() - started };
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message };
  }
}
