/**
 * Bulk SGP4 work for the globe: one SatRec per visible object, propagated to
 * one instant (marker positions) or sampled over a window (orbit paths).
 *
 * Framework-free and DOM-free. The same class runs inside the propagation
 * Web Worker and, when workers are unavailable, on the main thread. Results
 * use transferable typed arrays so the worker hands them over without copying.
 */
import { createBatchBuffers, propagateBatch } from '../../../core/orbit/satellite-propagator';
import { sampleOrbitsPacked, type OrbitWindow } from '../../../core/orbit/orbit-sampling';
import { createSatrec, type SatRec } from '../../../core/orbit/sgp4';

export interface TleLines {
  line1: string;
  line2: string;
}

export type BulkRequest =
  | { kind: 'set'; version: number; tles: TleLines[] }
  | { kind: 'propagate'; timeMs: number }
  | { kind: 'orbits'; requestId: number; window: OrbitWindow; samplesPerPeriod: number };

export interface PropagateResponse {
  kind: 'propagate';
  version: number;
  timeMs: number;
  /** TEME, km. Layout as `propagateBatch`. */
  positionsKm: Float64Array;
  velocitiesKmS: Float64Array;
  valid: Uint8Array;
  okCount: number;
}

export interface OrbitsResponse {
  kind: 'orbits';
  version: number;
  requestId: number;
  /** TEME, km, paths concatenated. */
  positionsKm: Float32Array;
  counts: Uint32Array;
}

export interface SetResponse {
  kind: 'set';
  version: number;
  /** Objects whose elements SGP4 refused to initialize. */
  initFailures: number;
}

export type BulkResponse = PropagateResponse | OrbitsResponse | SetResponse;

export class BulkEngine {
  private satrecs: (SatRec | null)[] = [];
  private version = -1;

  /**
   * Handles one request. Results are tagged with the version of the set they
   * were computed from (requests are processed in order, so this is the
   * latest `set` received); the client drops results for superseded sets.
   */
  handle(req: BulkRequest): { response: BulkResponse; transfer: ArrayBuffer[] } {
    switch (req.kind) {
      case 'set': {
        this.version = req.version;
        let initFailures = 0;
        this.satrecs = req.tles.map((t) => {
          try {
            return createSatrec(t);
          } catch {
            initFailures++;
            return null;
          }
        });
        return { response: { kind: 'set', version: req.version, initFailures }, transfer: [] };
      }
      case 'propagate': {
        const out = createBatchBuffers(this.satrecs.length);
        // propagateBatch skips null slots (valid = 0).
        const okCount = propagateBatch(this.satrecs as SatRec[], req.timeMs, out);
        return {
          response: { kind: 'propagate', version: this.version, timeMs: req.timeMs, okCount, ...out },
          transfer: [out.positionsKm.buffer, out.velocitiesKmS.buffer, out.valid.buffer] as ArrayBuffer[],
        };
      }
      case 'orbits': {
        const packed = sampleOrbitsPacked(this.satrecs, req.window, req.samplesPerPeriod);
        return {
          response: { kind: 'orbits', version: this.version, requestId: req.requestId, ...packed },
          transfer: [packed.positionsKm.buffer as ArrayBuffer, packed.counts.buffer as ArrayBuffer],
        };
      }
    }
  }
}
