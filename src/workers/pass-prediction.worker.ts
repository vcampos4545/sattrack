/// <reference lib="webworker" />
/**
 * Pass prediction off the main thread. A 7-day search is tens of thousands of
 * SGP4 evaluations (about 0.1 to 0.5 s), which would otherwise stall the globe.
 * One request at a time; the scheduler drops superseded responses by id.
 */
import { runPassSearch, type PassSearchRequest } from '../services/pass-search';

self.onmessage = (event: MessageEvent<PassSearchRequest>) => {
  self.postMessage(runPassSearch(event.data));
};
