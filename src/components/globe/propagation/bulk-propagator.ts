/**
 * Main-thread client of the bulk propagation engine.
 *
 * Decouples propagation from rendering (spec section 12): the render loop
 * calls `tick()` every frame, and a new SGP4 batch is requested only when
 *   - `1 / propagationHz` wall-clock seconds have passed, or
 *   - simulation time has moved more than `REPROPAGATE_SIM_S` from the last
 *     batch (fast-forward, rewind, jump), so extrapolation stays short.
 * At most one batch is in flight. Between batches the renderer extrapolates
 * each marker with `extrapolateTwoBody` (core/orbit/extrapolation.ts).
 *
 * Runs `BulkEngine` in a Web Worker when available and falls back to the
 * main thread (same code) when the worker cannot start.
 */
import type { OrbitWindow } from '../../../core/orbit/orbit-sampling';
import type { SatelliteRecord } from '../../../types/satellite';
import {
  BulkEngine,
  type BulkRequest,
  type BulkResponse,
  type OrbitsResponse,
  type PropagateResponse,
} from './bulk-engine';

/** Re-propagate when the simulation clock is this far (seconds) from the last batch. */
export const REPROPAGATE_SIM_S = 20;

export type PropagationSnapshot = PropagateResponse;

const toLines = (r: SatelliteRecord) => ({ line1: r.tle.line1, line2: r.tle.line2 });

type Pending = { resolve: (r: OrbitsResponse | null) => void };

export class BulkPropagator {
  private worker: Worker | null = null;
  private fallback: BulkEngine | null = null;
  private version = 0;
  private inFlight = false;
  private lastRequestWallMs = -Infinity;
  private requestSeq = 0;
  private pendingOrbits = new Map<number, Pending>();
  private disposed = false;

  /** Latest batch for the current satellite set, or null until the first one arrives. */
  latest: PropagationSnapshot | null = null;
  /** Objects whose elements SGP4 refused, for the current set. */
  initFailures = 0;

  /** Increments on every `setSatellites`, so consumers can tell when the set changed. */
  get setVersion(): number {
    return this.version;
  }

  constructor() {
    try {
      this.worker = new Worker(new URL('./propagation.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<BulkResponse | { kind: 'error'; message: string }>) => {
        const msg = e.data;
        if (msg.kind === 'error') {
          console.error('[globe] propagation worker error:', msg.message);
          this.inFlight = false;
          return;
        }
        this.receive(msg);
      };
      this.worker.onerror = (e) => {
        console.error('[globe] propagation worker failed, using main thread', e.message);
        this.switchToFallback();
      };
    } catch (err) {
      console.warn('[globe] Web Worker unavailable, propagating on the main thread', err);
      this.switchToFallback();
    }
  }

  private records: SatelliteRecord[] = [];

  private switchToFallback() {
    this.worker?.terminate();
    this.worker = null;
    this.fallback = new BulkEngine();
    this.inFlight = false;
    // Replay the current set into the new engine.
    this.send({ kind: 'set', version: this.version, tles: this.records.map(toLines) });
    for (const p of this.pendingOrbits.values()) p.resolve(null);
    this.pendingOrbits.clear();
  }

  private send(req: BulkRequest) {
    if (this.disposed) return;
    if (this.worker) {
      this.worker.postMessage(req);
      return;
    }
    // Main-thread fallback: answer asynchronously to keep one code path.
    const engine = (this.fallback ??= new BulkEngine());
    queueMicrotask(() => {
      if (this.disposed) return;
      try {
        this.receive(engine.handle(req).response);
      } catch (err) {
        console.error('[globe] propagation failed', err);
        this.inFlight = false;
      }
    });
  }

  private receive(msg: BulkResponse) {
    if (msg.kind === 'set') {
      if (msg.version === this.version) {
        this.initFailures = msg.initFailures;
        if (msg.initFailures) console.warn(`[globe] SGP4 rejected ${msg.initFailures} element set(s)`);
      }
      return;
    }
    if (msg.kind === 'propagate') {
      this.inFlight = false;
      if (msg.version === this.version) this.latest = msg;
      return;
    }
    const pending = this.pendingOrbits.get(msg.requestId);
    this.pendingOrbits.delete(msg.requestId);
    pending?.resolve(msg.version === this.version ? msg : null);
  }

  /** Replaces the propagated set. Index i of every result is `records[i]`. */
  setSatellites(records: SatelliteRecord[]) {
    this.records = records;
    this.version++;
    this.latest = null;
    this.inFlight = false;
    this.initFailures = 0;
    this.send({ kind: 'set', version: this.version, tles: records.map(toLines) });
  }

  /** Call once per rendered frame. Requests a new batch when one is due. */
  tick(simMs: number, wallMs: number, propagationHz: number) {
    if (this.inFlight) return;
    const latest = this.latest;
    const due =
      latest === null ||
      (wallMs - this.lastRequestWallMs >= 1000 / propagationHz && simMs !== latest.timeMs) ||
      Math.abs(simMs - latest.timeMs) > REPROPAGATE_SIM_S * 1000;
    if (!due) return;
    this.inFlight = true;
    this.lastRequestWallMs = wallMs;
    this.send({ kind: 'propagate', timeMs: simMs });
  }

  /** Samples every object's orbit over `window`. Resolves null if the set changed meanwhile. */
  sampleOrbits(window: OrbitWindow, samplesPerPeriod: number): Promise<OrbitsResponse | null> {
    const requestId = ++this.requestSeq;
    return new Promise((resolve) => {
      this.pendingOrbits.set(requestId, { resolve });
      this.send({ kind: 'orbits', requestId, window, samplesPerPeriod });
    });
  }

  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pendingOrbits.values()) p.resolve(null);
    this.pendingOrbits.clear();
  }
}
