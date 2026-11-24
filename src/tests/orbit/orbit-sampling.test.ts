import { describe, expect, it } from 'vitest';
import { orbitWindowBounds, sampleOrbitsPacked } from '../../core/orbit/orbit-sampling';
import { computeSatelliteState, orbitalPeriodMin } from '../../core/orbit/satellite-propagator';
import { satrecFor } from '../../core/orbit/sgp4';
import { parseTlePair } from '../../core/orbit/tle-parser';

const ISS = parseTlePair(
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
);
const GEO = parseTlePair(
  'TEST GEO',
  '1 41866U 16071A   26320.50000000 -.00000088  00000-0  00000-0 0  9995',
  '2 41866   0.0500  95.0000 0001000 270.0000  90.0000  1.00271000 30009',
);

describe('orbitWindowBounds', () => {
  it('places trailFraction of the span before the center', () => {
    const w = orbitWindowBounds(100, { centerMs: 1_000_000, periods: 2, trailFraction: 0.25 });
    expect(w.endMs - w.startMs).toBe(200 * 60_000);
    expect(1_000_000 - w.startMs).toBe(50 * 60_000);
  });
});

describe('sampleOrbitsPacked', () => {
  const center = ISS.epochMs + 2 * 3_600_000;
  const window = { centerMs: center, periods: 1, trailFraction: 0.25 };

  it('samples each object over its own period and matches SGP4 exactly', () => {
    const iss = satrecFor(ISS);
    const geo = satrecFor(GEO);
    const packed = sampleOrbitsPacked([iss, null, geo], window, 90);
    expect(Array.from(packed.counts)).toEqual([91, 0, 91]);
    expect(packed.positionsKm.length).toBe(182 * 3);

    // First ISS sample is the window start; compare with a direct propagation.
    const { startMs } = orbitWindowBounds(orbitalPeriodMin(iss), window);
    const ref = computeSatelliteState(iss, startMs)!;
    expect(packed.positionsKm[0]).toBeCloseTo(ref.teme.positionKm.x, 2);
    expect(packed.positionsKm[1]).toBeCloseTo(ref.teme.positionKm.y, 2);
    expect(packed.positionsKm[2]).toBeCloseTo(ref.teme.positionKm.z, 2);
  });

  it('draws a near-closed loop for one period (TEME is inertial)', () => {
    const packed = sampleOrbitsPacked([satrecFor(ISS)], window, 90);
    const n = packed.counts[0]!;
    const p = packed.positionsKm;
    const gap = Math.hypot(p[0]! - p[(n - 1) * 3]!, p[1]! - p[(n - 1) * 3 + 1]!, p[2]! - p[(n - 1) * 3 + 2]!);
    // Nodal regression and drag open the loop by only tens of km per orbit.
    expect(gap).toBeLessThan(60);
    // GEO radius stays ~42164 km along the whole path.
    const geo = sampleOrbitsPacked([satrecFor(GEO)], window, 90);
    for (let i = 0; i < geo.counts[0]!; i++) {
      const r = Math.hypot(geo.positionsKm[i * 3]!, geo.positionsKm[i * 3 + 1]!, geo.positionsKm[i * 3 + 2]!);
      expect(Math.abs(r - 42164)).toBeLessThan(30);
    }
  });
});
