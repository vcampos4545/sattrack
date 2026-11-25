import { describe, expect, it } from 'vitest';
import { BulkEngine, type BulkRequest } from '../../components/globe/propagation/bulk-engine';
import { BulkPropagator } from '../../components/globe/propagation/bulk-propagator';
import { parseTlePair } from '../../core/orbit/tle-parser';
import type { SatelliteRecord } from '../../types/satellite';

const ISS = parseTlePair(
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
);
const RECORDS: SatelliteRecord[] = [{ noradId: ISS.noradId, name: ISS.name, category: 'iss', groups: ['stations'], tle: ISS }];
const T = ISS.epochMs + 600_000;

/**
 * Stand-in for a module Web Worker: runs a real BulkEngine and answers
 * asynchronously. `hold` keeps responses of one request kind back until
 * `release()`, to model a worker busy with a long job.
 */
class FakeWorker {
  static created: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  received: string[] = [];
  terminated = false;
  private engine = new BulkEngine();
  private held: (() => void)[] = [];
  hold: BulkRequest['kind'] | null = null;
  constructor() {
    FakeWorker.created.push(this);
  }
  postMessage(req: BulkRequest) {
    this.received.push(req.kind);
    const answer = () => {
      if (!this.terminated) this.onmessage?.({ data: this.engine.handle(req).response });
    };
    if (req.kind === this.hold) this.held.push(answer);
    else setTimeout(answer, 0);
  }
  release() {
    this.held.splice(0).forEach((f) => f());
  }
  crash() {
    this.onerror?.({ message: 'boom' });
  }
  terminate() {
    this.terminated = true;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function setup() {
  FakeWorker.created = [];
  return new BulkPropagator({ createWorker: () => new FakeWorker() as unknown as Worker });
}

describe('BulkPropagator', () => {
  it('propagates in a worker and starts the orbit worker only when orbits are requested', async () => {
    const p = setup();
    p.setSatellites(RECORDS);
    p.tick(T, 0, 1);
    await tick();
    expect(FakeWorker.created).toHaveLength(1);
    expect(p.latest?.okCount).toBe(1);
    expect(p.latest?.timeMs).toBe(T);

    const res = await p.sampleOrbits({ centerMs: T, periods: 1, trailFraction: 0.25 }, 30);
    expect(FakeWorker.created).toHaveLength(2);
    // The new worker got the current set before the sampling request.
    expect(FakeWorker.created[1]!.received).toEqual(['set', 'orbits']);
    expect(res?.counts[0]).toBe(31);
    p.dispose();
  });

  it('keeps delivering marker batches while orbit sampling is busy', async () => {
    const p = setup();
    p.setSatellites(RECORDS);
    const orbits = p.sampleOrbits({ centerMs: T, periods: 1, trailFraction: 0.25 }, 30);
    FakeWorker.created[1]!.hold = 'orbits';
    // The orbit request was posted before `hold` was set, so post one more that is held.
    const held = p.sampleOrbits({ centerMs: T, periods: 1, trailFraction: 0.25 }, 30);
    await orbits;
    p.tick(T, 0, 1);
    await tick();
    expect(p.latest?.timeMs).toBe(T);
    p.tick(T + 30_000, 2000, 1);
    await tick();
    expect(p.latest?.timeMs).toBe(T + 30_000);
    FakeWorker.created[1]!.release();
    expect((await held)?.counts[0]).toBe(31);
    p.dispose();
  });

  it('sends every new set to both workers and drops orbit results for an old set', async () => {
    const p = setup();
    p.setSatellites(RECORDS);
    const orbitWorker = () => FakeWorker.created[1]!;
    const first = p.sampleOrbits({ centerMs: T, periods: 1, trailFraction: 0.25 }, 30);
    orbitWorker().hold = 'orbits';
    const stale = p.sampleOrbits({ centerMs: T, periods: 1, trailFraction: 0.25 }, 30);
    await first;
    p.setSatellites(RECORDS);
    orbitWorker().release();
    expect(await stale).toBeNull();
    expect(FakeWorker.created[0]!.received.filter((k) => k === 'set')).toHaveLength(2);
    expect(orbitWorker().received.filter((k) => k === 'set')).toHaveLength(2);
    p.dispose();
  });

  it('falls back to the main thread when workers cannot start', async () => {
    const p = new BulkPropagator({
      createWorker: () => {
        throw new Error('no workers here');
      },
    });
    p.setSatellites(RECORDS);
    p.tick(T, 0, 1);
    await tick();
    expect(p.latest?.okCount).toBe(1);
    const res = await p.sampleOrbits({ centerMs: T, periods: 1, trailFraction: 0.25 }, 30);
    expect(res?.counts[0]).toBe(31);
    p.dispose();
  });

  it('recovers on the main thread after a worker crash', async () => {
    const p = setup();
    p.setSatellites(RECORDS);
    const orbits = p.sampleOrbits({ centerMs: T, periods: 1, trailFraction: 0.25 }, 30);
    await orbits;
    FakeWorker.created[1]!.hold = 'orbits';
    const lost = p.sampleOrbits({ centerMs: T, periods: 1, trailFraction: 0.25 }, 30);
    FakeWorker.created[1]!.crash();
    expect(await lost).toBeNull();
    expect(FakeWorker.created[1]!.terminated).toBe(true);
    // The orbit channel now runs on the main thread with the replayed set.
    const again = await p.sampleOrbits({ centerMs: T, periods: 1, trailFraction: 0.25 }, 30);
    expect(again?.counts[0]).toBe(31);

    // A propagation crash mid-batch does not leave a batch stuck in flight.
    FakeWorker.created[0]!.hold = 'propagate';
    p.tick(T, 0, 1);
    FakeWorker.created[0]!.crash();
    p.tick(T, 1, 1);
    await tick();
    expect(p.latest?.timeMs).toBe(T);
    p.dispose();
  });
});
