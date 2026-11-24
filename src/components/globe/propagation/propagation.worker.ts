/**
 * Web Worker host for `BulkEngine`, so bulk SGP4 (thousands of objects with
 * Starlink or "active" enabled) never blocks the render loop.
 */
import { BulkEngine, type BulkRequest } from './bulk-engine';

const engine = new BulkEngine();
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<BulkRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  try {
    const { response, transfer } = engine.handle(e.data);
    scope.postMessage(response, transfer);
  } catch (err) {
    scope.postMessage({ kind: 'error', message: (err as Error).message }, []);
  }
};
