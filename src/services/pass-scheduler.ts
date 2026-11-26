/**
 * Decides when to (re)compute passes and runs the searches in Web Workers.
 *
 * Two modes, from the satellite store's `trackedOnly` filter:
 * - selected: one search for the selected satellite.
 * - tracked: one search per Tracked-list satellite, merged into one schedule
 *   sorted by AOS (`mergePassSchedule`).
 *
 * Inputs per satellite: its TLE, the observer location, and the settings
 * `elevationMaskDeg`, `passCount`, `passSearchDays`, `passScanStepS`. Each
 * satellite's result is cached under a key of those inputs, so adding one
 * object to the Tracked list searches only that object, and toggling the
 * filter reuses results that are still valid. A cached result is reused as
 * simulation time advances, and only recomputed when `needsRecompute` says it
 * has gone stale: a pass ended (so the list is short by one), the clock moved
 * before the search start, or the search window has slid far enough to
 * reveal new passes.
 *
 * Searches run on a small pool of workers (one search per worker at a time;
 * the selected mode uses one). A search for inputs that are no longer
 * current is abandoned (its worker is terminated) and late responses are
 * ignored by request id. When Web Workers are unavailable the searches run on
 * the main thread, one per macrotask, which is slower but correct.
 */
import type { PassSearchResult } from '../core/orbit/pass-prediction';
import { selectSelectedSatellite, useSatelliteStore } from '../stores/satellite-store';
import { useObserverStore } from '../stores/observer-store';
import { INITIAL_PASS_STATE, mergePassSchedule, usePassStore, type PassScheduleMode } from '../stores/pass-store';
import { useSettingsStore } from '../stores/settings-store';
import { getSimTimeMs, useTimeStore } from '../stores/time-store';
import type { Pass } from '../types/passes';
import type { SatelliteRecord } from '../types/satellite';
import type { PassSearchRequest, PassSearchResponse } from './pass-search';
import { runPassSearch } from './pass-search';

/** How often simulation time is checked against the current results. */
const TIME_CHECK_INTERVAL_MS = 1000;
/** Upper bound on pass-search workers for the Tracked list. */
const MAX_WORKERS = 3;

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

type SearchOptions = Omit<PassSearchRequest['options'], 'startMs'>;

interface Job {
  /** Every input of the search; a change means a new search. */
  key: string;
  noradId: number;
  line1: string;
  line2: string;
}

interface Inputs {
  mode: PassScheduleMode;
  jobs: Job[];
  observer: PassSearchRequest['observer'];
  options: SearchOptions;
}

function readInputs(): Inputs {
  const sat = useSatelliteStore.getState();
  const mode: PassScheduleMode = sat.trackedOnly ? 'tracked' : 'selected';
  let records: SatelliteRecord[];
  if (mode === 'tracked') records = sat.trackedRecords;
  else {
    const selected = selectSelectedSatellite(sat);
    records = selected ? [selected] : [];
  }
  const observer = useObserverStore.getState().location;
  const s = useSettingsStore.getState();
  const options: SearchOptions = {
    elevationMaskDeg: s.elevationMaskDeg,
    maxPasses: s.passCount,
    searchDays: s.passSearchDays,
    scanStepS: s.passScanStepS,
  };
  const shared = [
    observer.latitudeDeg,
    observer.longitudeDeg,
    observer.altitudeM,
    options.elevationMaskDeg,
    options.maxPasses,
    options.searchDays,
    options.scanStepS,
  ].join('|');
  const jobs = records.map((r) => ({
    key: `${r.noradId}|${r.tle.line1}|${r.tle.line2}|${shared}`,
    noradId: r.noradId,
    line1: r.tle.line1,
    line2: r.tle.line2,
  }));
  return { mode, jobs, observer, options };
}

interface Slot {
  worker: Worker | null;
  job: { id: number; key: string } | null;
}

let workerUnavailable = false;
let seq = 0;
let slots: Slot[] = [];
/** Latest result per job key, for the current inputs only. */
const cache = new Map<string, PassSearchResult>();
/** Failed searches per job key; retried only when the inputs change. */
const failed = new Map<string, string>();
/** Last passes received per satellite, kept across input changes so a selected pass can be followed. */
const lastPasses = new Map<number, Pass[]>();
let lastComputeMs: number | null = null;
/** Bumped on every change publish() must reflect (results, failures, in-flight set). */
let version = 0;
let publishedSignature: string | null = null;
let searchCount = 0;

/** Searches started since the scheduler was loaded. For tests and diagnostics. */
export function passSearchCount(): number {
  return searchCount;
}

function poolSize(mode: PassScheduleMode): number {
  if (mode === 'selected' || workerUnavailable || typeof Worker === 'undefined') return 1;
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
}

function createWorker(slot: Slot): Worker | null {
  if (workerUnavailable || typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('../workers/pass-prediction.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<PassSearchResponse>) => handleResponse(slot, e.data);
    w.onerror = (e) => {
      console.error('[passes] worker failed; falling back to the main thread', e.message);
      workerUnavailable = true;
      // Re-run whatever was in flight on the main thread.
      stopAll();
      evaluate();
    };
    return w;
  } catch (err) {
    console.warn('[passes] Web Worker unavailable; computing on the main thread', err);
    workerUnavailable = true;
    return null;
  }
}

function stopSlot(slot: Slot): void {
  slot.worker?.terminate();
  slot.worker = null;
  slot.job = null;
}

function stopAll(): void {
  slots.forEach(stopSlot);
  slots = [];
  version++;
}

function isInflight(key: string): boolean {
  return slots.some((s) => s.job?.key === key);
}

function dispatch(slot: Slot, job: Job, inputs: Inputs, nowMs: number): void {
  const id = ++seq;
  slot.job = { id, key: job.key };
  searchCount++;
  version++;
  const request: PassSearchRequest = {
    id,
    noradId: job.noradId,
    line1: job.line1,
    line2: job.line2,
    observer: inputs.observer,
    options: { ...inputs.options, startMs: nowMs },
  };
  slot.worker ??= createWorker(slot);
  if (slot.worker) slot.worker.postMessage(request);
  else setTimeout(() => handleResponse(slot, runPassSearch(request)), 0);
}

function handleResponse(slot: Slot, res: PassSearchResponse): void {
  const job = slot.job;
  if (!job || res.id !== job.id) return; // superseded
  slot.job = null;
  version++;
  if (!res.ok) {
    console.error('[passes] search failed', res.error);
    failed.set(job.key, res.error);
  } else {
    const { result, computeMs } = res;
    console.debug(
      `[passes] NORAD ${result.noradId}: ${result.passes.length} pass(es), status ${result.status}, ` +
        `${result.evaluations} evaluations in ${computeMs.toFixed(0)} ms`,
    );
    if (result.propagationFailures > 0) {
      console.warn(`[passes] NORAD ${result.noradId}: ${result.propagationFailures} SGP4 failures during the scan`);
    }
    cache.set(job.key, result);
    lastComputeMs = computeMs;
    reconcileSelection(lastPasses.get(result.noradId) ?? [], result);
    lastPasses.set(result.noradId, result.passes);
  }
  evaluate();
}

/**
 * Keeps the selected pass selected across a recompute of its satellite, or
 * clears a pass that no longer exists.
 */
function reconcileSelection(previous: readonly Pass[], next: PassSearchResult): void {
  const sat = useSatelliteStore.getState();
  const id = sat.selectedPassId;
  if (id === null || sat.selectedId !== next.noradId || next.passes.some((p) => p.id === id)) return;
  const old = previous.find((p) => p.id === id);
  const match = old ? matchPass(old, next.passes) : null;
  sat.selectPass(match ? match.id : null);
}

function publish(inputs: Inputs): void {
  const signature = `${inputs.mode}#${version}#${inputs.jobs.map((j) => j.key).join(',')}`;
  if (signature === publishedSignature) return;
  publishedSignature = signature;

  const results = new Map<number, PassSearchResult>();
  const failures = new Map<number, string>();
  let pendingCount = 0;
  let refreshing = false;
  for (const job of inputs.jobs) {
    const r = cache.get(job.key);
    const err = failed.get(job.key);
    if (r) {
      results.set(job.noradId, r);
      if (isInflight(job.key)) refreshing = true;
    } else if (err !== undefined) failures.set(job.noradId, err);
    else pendingCount++;
  }
  const totalCount = inputs.jobs.length;
  const firstError = failures.values().next().value ?? null;

  if (totalCount === 0) {
    usePassStore.setState({ ...INITIAL_PASS_STATE, mode: inputs.mode });
    return;
  }
  if (inputs.mode === 'selected') {
    const job = inputs.jobs[0]!;
    const result = results.get(job.noradId) ?? null;
    usePassStore.setState({
      mode: 'selected',
      state: firstError !== null ? 'error' : result ? 'ready' : 'computing',
      noradId: job.noradId,
      result,
      results,
      passes: result?.passes ?? [],
      horizonMs: null,
      pendingCount,
      totalCount,
      refreshing,
      error: firstError,
      failures,
      computeMs: lastComputeMs,
    });
    return;
  }
  const merged = mergePassSchedule(results.values());
  usePassStore.setState({
    mode: 'tracked',
    state: failures.size === totalCount ? 'error' : results.size === 0 ? 'computing' : 'ready',
    noradId: null,
    result: null,
    results,
    passes: merged.passes,
    horizonMs: merged.horizonMs,
    pendingCount,
    totalCount,
    refreshing,
    error: firstError,
    failures,
    computeMs: lastComputeMs,
  });
}

/** Checks inputs and simulation time; starts searches when needed. */
function evaluate(): void {
  const inputs = readInputs();
  const keys = new Set(inputs.jobs.map((j) => j.key));

  // Forget results and abandon searches for inputs that are no longer current.
  for (const k of [...cache.keys()]) if (!keys.has(k)) cache.delete(k);
  for (const k of [...failed.keys()]) if (!keys.has(k)) failed.delete(k);
  for (const slot of slots) {
    if (slot.job && !keys.has(slot.job.key)) {
      stopSlot(slot);
      version++;
    }
  }

  const size = poolSize(inputs.mode);
  while (slots.length < size) slots.push({ worker: null, job: null });
  // Shrink an idle pool (e.g. back to one worker in selected mode).
  for (let i = slots.length - 1; i >= size; i--) {
    if (slots[i]!.job === null) {
      stopSlot(slots[i]!);
      slots.splice(i, 1);
    }
  }

  const nowMs = getSimTimeMs();
  const { maxPasses } = inputs.options;
  // Satellites with no result first, then stale ones.
  const missing: Job[] = [];
  const stale: Job[] = [];
  for (const job of inputs.jobs) {
    if (isInflight(job.key) || failed.has(job.key)) continue;
    const r = cache.get(job.key);
    if (!r) missing.push(job);
    else if (needsRecompute(r, nowMs, maxPasses)) stale.push(job);
  }
  const queue = [...missing, ...stale];
  for (const slot of slots) {
    if (queue.length === 0) break;
    if (slot.job === null) dispatch(slot, queue.shift()!, inputs, nowMs);
  }
  publish(inputs);
}

let refs = 0;
let teardown: (() => void) | null = null;

/**
 * Starts the scheduler (reference counted). Returns a release function. The
 * scheduler stops, and its workers are terminated, when the last holder releases.
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
      stopAll();
      cache.clear();
      failed.clear();
      lastPasses.clear();
      publishedSignature = null;
      usePassStore.setState({ ...INITIAL_PASS_STATE });
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
