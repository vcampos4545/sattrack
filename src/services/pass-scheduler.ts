/**
 * Decides when to (re)compute passes and runs the search in a Web Worker.
 *
 * Inputs: selected satellite (its TLE), observer location, and the settings
 * `elevationMaskDeg`, `passCount`, `passSearchDays`, `passScanStepS`. A
 * change to any of them starts a new search anchored at the current
 * simulation time. Otherwise the existing result is reused as simulation time
 * advances, and only recomputed when `needsRecompute` says it has gone stale:
 * a pass ended (so the list is short by one), the clock moved before the
 * search start, or the search window has slid far enough to reveal new passes.
 *
 * Only one search runs at a time. A search for outdated inputs is abandoned
 * (the worker is restarted) and late responses are ignored by request id.
 * When Web Workers are unavailable the search runs on the main thread in a
 * macrotask, which is slower but correct.
 */
import type { PassSearchResult } from '../core/orbit/pass-prediction';
import { selectSelectedSatellite, useSatelliteStore } from '../stores/satellite-store';
import { useObserverStore } from '../stores/observer-store';
import { INITIAL_PASS_STATE, usePassStore } from '../stores/pass-store';
import { useSettingsStore } from '../stores/settings-store';
import { getSimTimeMs, useTimeStore } from '../stores/time-store';
import type { Pass } from '../types/passes';
import type { PassSearchRequest, PassSearchResponse } from './pass-search';
import { runPassSearch } from './pass-search';

/** How often simulation time is checked against the current result. */
const TIME_CHECK_INTERVAL_MS = 1000;

/**
 * True when a result computed earlier no longer describes "the next passes
 * from `nowMs`". Pure; exported for tests.
 */
export function needsRecompute(result: PassSearchResult, nowMs: number, maxPasses: number): boolean {
  // Clock moved back before the search start: earlier passes are missing.
  if (nowMs < result.searchStartMs - 1000) return true;
  // A pass finished: drop it and fill the list back up.
  if (result.passes.some((p) => p.losMs <= nowMs)) return true;
  // Fewer passes than requested means the window limited the search; once it
  // has slid by an eighth of its length, newly reachable passes may exist.
  if (result.passes.length < maxPasses) {
    const windowMs = result.windowEndMs - result.searchStartMs;
    if (nowMs - result.searchStartMs > windowMs / 8) return true;
  }
  return false;
}

/**
 * After a recompute, finds the new pass that corresponds to a previously
 * selected one: the pass whose AOS..LOS contains the old pass's peak. Pass
 * ids embed the AOS time, which shifts slightly when the mask or scan step
 * changes, so ids alone cannot follow a pass. Exported for tests.
 */
export function matchPass(previous: Pass, candidates: readonly Pass[]): Pass | null {
  return (
    candidates.find(
      (p) => p.noradId === previous.noradId && p.aosMs <= previous.maxElevationMs && p.losMs >= previous.maxElevationMs,
    ) ?? null
  );
}

interface Inputs {
  key: string;
  request: Omit<PassSearchRequest, 'id' | 'options'> & { options: Omit<PassSearchRequest['options'], 'startMs'> };
}

function readInputs(): Inputs | null {
  const record = selectSelectedSatellite(useSatelliteStore.getState());
  if (!record) return null;
  const observer = useObserverStore.getState().location;
  const s = useSettingsStore.getState();
  const options = {
    elevationMaskDeg: s.elevationMaskDeg,
    maxPasses: s.passCount,
    searchDays: s.passSearchDays,
    scanStepS: s.passScanStepS,
  };
  const key = [
    record.noradId,
    record.tle.line1,
    record.tle.line2,
    observer.latitudeDeg,
    observer.longitudeDeg,
    observer.altitudeM,
    options.elevationMaskDeg,
    options.maxPasses,
    options.searchDays,
    options.scanStepS,
  ].join('|');
  return {
    key,
    request: { noradId: record.noradId, line1: record.tle.line1, line2: record.tle.line2, observer, options },
  };
}

let worker: Worker | null = null;
let workerUnavailable = false;
let seq = 0;
let inflight: { id: number; key: string } | null = null;
let currentKey: string | null = null;
let lastPasses: Pass[] = [];

function getWorker(): Worker | null {
  if (workerUnavailable || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/pass-prediction.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<PassSearchResponse>) => handleResponse(e.data);
    worker.onerror = (e) => {
      console.error('[passes] worker failed; falling back to the main thread', e.message);
      worker?.terminate();
      worker = null;
      workerUnavailable = true;
      // Re-run whatever was in flight on the main thread.
      inflight = null;
      currentKey = null;
      evaluate();
    };
  } catch (err) {
    console.warn('[passes] Web Worker unavailable; computing on the main thread', err);
    workerUnavailable = true;
    worker = null;
  }
  return worker;
}

function start(inputs: Inputs, nowMs: number, newInputs: boolean): void {
  // Abandon a search for outdated inputs rather than queueing behind it.
  if (inflight && worker) {
    worker.terminate();
    worker = null;
  }
  const id = ++seq;
  inflight = { id, key: inputs.key };
  currentKey = inputs.key;
  const request: PassSearchRequest = {
    ...inputs.request,
    id,
    options: { ...inputs.request.options, startMs: nowMs },
  };
  if (newInputs) {
    usePassStore.setState({
      state: 'computing',
      noradId: request.noradId,
      result: null,
      passes: [],
      refreshing: false,
      error: null,
    });
  } else {
    usePassStore.setState({ refreshing: true });
  }
  const w = getWorker();
  if (w) w.postMessage(request);
  else setTimeout(() => handleResponse(runPassSearch(request)), 0);
}

function handleResponse(res: PassSearchResponse): void {
  if (!inflight || res.id !== inflight.id) return; // superseded
  inflight = null;
  if (!res.ok) {
    console.error('[passes] search failed', res.error);
    usePassStore.setState({ state: 'error', error: res.error, refreshing: false, result: null, passes: [] });
    return;
  }
  const { result, computeMs } = res;
  console.debug(
    `[passes] NORAD ${result.noradId}: ${result.passes.length} pass(es), status ${result.status}, ` +
      `${result.evaluations} evaluations in ${computeMs.toFixed(0)} ms`,
  );
  if (result.propagationFailures > 0) {
    console.warn(`[passes] NORAD ${result.noradId}: ${result.propagationFailures} SGP4 failures during the scan`);
  }
  usePassStore.setState({
    state: 'ready',
    noradId: result.noradId,
    result,
    passes: result.passes,
    refreshing: false,
    error: null,
    computeMs,
  });
  reconcileSelection(result.passes);
  lastPasses = result.passes;
}

/** Keeps the selected pass selected across recomputes, or clears a pass that no longer exists. */
function reconcileSelection(passes: Pass[]): void {
  const sat = useSatelliteStore.getState();
  const id = sat.selectedPassId;
  if (id === null || passes.some((p) => p.id === id)) return;
  const previous = lastPasses.find((p) => p.id === id);
  const match = previous ? matchPass(previous, passes) : null;
  sat.selectPass(match ? match.id : null);
}

/** Checks inputs and simulation time; starts a search when needed. */
function evaluate(): void {
  const inputs = readInputs();
  if (!inputs) {
    if (currentKey !== null || inflight) {
      inflight = null;
      currentKey = null;
      lastPasses = [];
      usePassStore.setState({ ...INITIAL_PASS_STATE });
    }
    return;
  }
  const nowMs = getSimTimeMs();
  if (inputs.key !== currentKey) {
    start(inputs, nowMs, true);
    return;
  }
  if (inflight) return;
  const { result, state } = usePassStore.getState();
  if (state === 'error') return; // retried when inputs change
  if (result && needsRecompute(result, nowMs, inputs.request.options.maxPasses)) start(inputs, nowMs, false);
}

let refs = 0;
let teardown: (() => void) | null = null;

/**
 * Starts the scheduler (reference counted). Returns a release function. The
 * scheduler stops, and its worker is terminated, when the last holder releases.
 */
export function retainPassScheduler(): () => void {
  if (refs++ === 0) {
    const unsubs = [
      useSatelliteStore.subscribe(evaluate),
      useObserverStore.subscribe(evaluate),
      useSettingsStore.subscribe(evaluate),
      useTimeStore.subscribe(evaluate),
    ];
    const timer = setInterval(evaluate, TIME_CHECK_INTERVAL_MS);
    evaluate();
    teardown = () => {
      unsubs.forEach((u) => u());
      clearInterval(timer);
      worker?.terminate();
      worker = null;
      inflight = null;
      currentKey = null;
      lastPasses = [];
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--refs === 0) {
      teardown?.();
      teardown = null;
    }
  };
}
