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
 * Two engines, two workers. Marker batches and orbit-path sampling run in
 * separate workers (`EngineChannel`s). Sampling every visible orbit is
 * hundreds of times more SGP4 work than one marker batch (about 0.3 s for
 * 13,000 objects), and in a single worker each marker batch would queue
 * behind it. During fast-forward that wait exceeds the extrapolation limit
 * and the markers blink out. The orbit worker starts on the first
 * `sampleOrbits` call, so a session that never draws all orbits never pays
 * for it.
 *
 * Each channel runs `BulkEngine` in a Web Worker when available and falls
 * back to the main thread (same code) when the worker cannot start.
 */
import type { OrbitWindow } from '../../../core/orbit/orbit-sampling';
import type { SatelliteRecord } from '../../../types/satellite';
import type { BulkRequest, BulkResponse, OrbitsResponse, PropagateResponse } from './bulk-engine';
import { EngineChannel } from './engine-channel';

/** Re-propagate when the simulation clock is this far (seconds) from the last batch. */
export const REPROPAGATE_SIM_S = 20;

export type PropagationSnapshot = PropagateResponse;

const toLines = (r: SatelliteRecord) => ({ line1: r.tle.line1, line2: r.tle.line2 });

export interface BulkPropagatorOptions {
  /** Worker factory override (tests). Return value per channel. */
  createWorker?: () => Worker;
}

export class BulkPropagator {
  private readonly propagation: EngineChannel;
  private orbits: EngineChannel | null = null;
  private version = 0;
  private inFlight = false;
  private lastRequestWallMs = -Infinity;
  private requestSeq = 0;
  private pendingOrbits = new Map<number, (r: OrbitsResponse | null) => void>();
  private disposed = false;
  private setRequest: BulkRequest | null = null;

  /** Latest batch for the current satellite set, or null until the first one arrives. */
  latest: PropagationSnapshot | null = null;
  /** Objects whose elements SGP4 refused, for the current set. */
  initFailures = 0;

  /** Increments on every `setSatellites`, so consumers can tell when the set changed. */
  get setVersion(): number {
    return this.version;
  }

  constructor(private readonly options: BulkPropagatorOptions = {}) {
    this.propagation = new EngineChannel({
      name: 'propagation',
      createWorker: options.createWorker,
      currentSet: () => this.setRequest,
      onResponse: (msg) => this.receive(msg),
      // The batch in flight is gone; the next tick requests a new one.
      onLost: () => {
        this.inFlight = false;
      },
    });
  }

  private orbitChannel(): EngineChannel {
    if (!this.orbits) {
      this.orbits = new EngineChannel({
        name: 'orbit sampling',
        createWorker: this.options.createWorker,
        currentSet: () => this.setRequest,
        onResponse: (msg) => {
          if (msg.kind === 'orbits') this.receiveOrbits(msg);
        },
        onLost: () => this.abandonOrbits(),
      });
      if (this.setRequest) this.orbits.send(this.setRequest);
    }
    return this.orbits;
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
    }
  }

  private receiveOrbits(msg: OrbitsResponse) {
    const resolve = this.pendingOrbits.get(msg.requestId);
    this.pendingOrbits.delete(msg.requestId);
    resolve?.(msg.version === this.version ? msg : null);
  }

  private abandonOrbits() {
    for (const resolve of this.pendingOrbits.values()) resolve(null);
    this.pendingOrbits.clear();
  }

  /** Replaces the propagated set. Index i of every result is `records[i]`. */
  setSatellites(records: SatelliteRecord[]) {
    this.version++;
    this.latest = null;
    this.inFlight = false;
    this.initFailures = 0;
    this.setRequest = { kind: 'set', version: this.version, tles: records.map(toLines) };
    this.propagation.send(this.setRequest);
    this.orbits?.send(this.setRequest);
  }

  /** Call once per rendered frame. Requests a new batch when one is due. */
  tick(simMs: number, wallMs: number, propagationHz: number) {
    if (this.inFlight || this.disposed) return;
    const latest = this.latest;
    const due =
      latest === null ||
      (wallMs - this.lastRequestWallMs >= 1000 / propagationHz && simMs !== latest.timeMs) ||
      Math.abs(simMs - latest.timeMs) > REPROPAGATE_SIM_S * 1000;
    if (!due) return;
    this.inFlight = true;
    this.lastRequestWallMs = wallMs;
    this.propagation.send({ kind: 'propagate', timeMs: simMs });
  }

  /** Samples every object's orbit over `window`. Resolves null if the set changed meanwhile. */
  sampleOrbits(window: OrbitWindow, samplesPerPeriod: number): Promise<OrbitsResponse | null> {
    if (this.disposed) return Promise.resolve(null);
    const requestId = ++this.requestSeq;
    const channel = this.orbitChannel();
    return new Promise((resolve) => {
      this.pendingOrbits.set(requestId, resolve);
      channel.send({ kind: 'orbits', requestId, window, samplesPerPeriod });
    });
  }

  dispose() {
    this.disposed = true;
    this.propagation.dispose();
    this.orbits?.dispose();
    this.abandonOrbits();
  }
}
