/**
 * One connection to a `BulkEngine`: a Web Worker when possible, otherwise the
 * same engine on the main thread. Responses always arrive asynchronously, so
 * callers have a single code path either way.
 *
 * If the worker cannot start or crashes, the channel switches to the main
 * thread for good and replays the current satellite set into the new engine.
 * Whenever requests in flight will get no answer (a crash, or one request
 * failing), the owner is told through `onLost` so it can re-issue or abandon
 * them.
 */
import { BulkEngine, type BulkRequest, type BulkResponse } from './bulk-engine';

export interface EngineChannelOptions {
  /** Used in log messages, e.g. "propagation". */
  name: string;
  onResponse(msg: BulkResponse): void;
  /** Requests sent so far will not be answered (a request failed, or the worker crashed). */
  onLost?(): void;
  /** The `set` request describing the current satellite set, replayed after a fallback. */
  currentSet(): BulkRequest | null;
  /** Override for tests; defaults to the bundled propagation worker. */
  createWorker?: () => Worker;
}

const defaultWorker = () => new Worker(new URL('./propagation.worker.ts', import.meta.url), { type: 'module' });

export class EngineChannel {
  private worker: Worker | null = null;
  private fallback: BulkEngine | null = null;
  private disposed = false;

  constructor(private readonly opts: EngineChannelOptions) {
    try {
      this.worker = (opts.createWorker ?? defaultWorker)();
      this.worker.onmessage = (e: MessageEvent<BulkResponse | { kind: 'error'; message: string }>) => {
        const msg = e.data;
        if (msg.kind === 'error') {
          console.error(`[globe] ${opts.name} worker error:`, msg.message);
          this.opts.onLost?.();
          return;
        }
        this.opts.onResponse(msg);
      };
      this.worker.onerror = (e) => {
        console.error(`[globe] ${opts.name} worker failed, using the main thread`, e.message);
        this.switchToFallback();
      };
    } catch (err) {
      console.warn(`[globe] Web Worker unavailable, ${opts.name} runs on the main thread`, err);
      this.worker = null;
    }
  }

  /** True when work runs in a Web Worker. */
  get usesWorker(): boolean {
    return this.worker !== null;
  }

  private switchToFallback() {
    this.worker?.terminate();
    this.worker = null;
    this.fallback = new BulkEngine();
    const set = this.opts.currentSet();
    if (set) this.send(set);
    this.opts.onLost?.();
  }

  send(req: BulkRequest, transfer: Transferable[] = []) {
    if (this.disposed) return;
    if (this.worker) {
      this.worker.postMessage(req, transfer);
      return;
    }
    // Main-thread fallback: answer asynchronously to keep one code path.
    const engine = (this.fallback ??= new BulkEngine());
    queueMicrotask(() => {
      if (this.disposed) return;
      let response: BulkResponse;
      try {
        response = engine.handle(req).response;
      } catch (err) {
        console.error(`[globe] ${this.opts.name} failed`, err);
        this.opts.onLost?.();
        return;
      }
      this.opts.onResponse(response);
    });
  }

  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.fallback = null;
  }
}
