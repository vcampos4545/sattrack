import { describe, expect, it } from 'vitest';
import { createSatrec, propagateMinutesSinceEpoch, propagateToTime, satrecFor } from '../../core/orbit/sgp4';
import { parseTlePair } from '../../core/orbit/tle-parser';

/**
 * Verification vectors from Vallado, Crawford, Hujsak & Kelso, "Revisiting
 * Spacetrack Report #3" (AIAA 2006-6753), file tcppver.out, satellite 00005
 * (Vanguard 1, near-Earth, e = 0.186). TEME km and km/s at minutes since epoch.
 */
const SAT5_L1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
const SAT5_L2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';

const SAT5_VECTORS: Array<{ t: number; r: [number, number, number]; v: [number, number, number] }> = [
  { t: 0, r: [7022.46529266, -1400.08296755, 0.03995155], v: [1.893841015, 6.405893759, 4.534807250] },
  { t: 360, r: [-7154.03120202, -3783.17682504, -3536.19412294], v: [4.741887409, -4.151817765, -2.093935425] },
  { t: 720, r: [-7134.59340119, 6531.68641334, 3260.27186483], v: [-4.113793027, -2.911922039, -2.557327851] },
];

describe('SGP4 (satellite.js) against Vallado verification vectors', () => {
  const satrec = createSatrec({ line1: SAT5_L1, line2: SAT5_L2 });

  for (const { t, r, v } of SAT5_VECTORS) {
    it(`matches satellite 00005 at t = ${t} min`, () => {
      const result = propagateMinutesSinceEpoch(satrec, t);
      if (!result.ok) throw new Error(result.error);
      const { positionKm: p, velocityKmS: vel } = result.state;
      // Published vectors carry 8 decimals; agreement to 1 m / 1 mm/s is a pass.
      expect(p.x).toBeCloseTo(r[0], 3);
      expect(p.y).toBeCloseTo(r[1], 3);
      expect(p.z).toBeCloseTo(r[2], 3);
      expect(vel.x).toBeCloseTo(v[0], 6);
      expect(vel.y).toBeCloseTo(v[1], 6);
      expect(vel.z).toBeCloseTo(v[2], 6);
    });
  }

  it('propagateToTime agrees with minutes-since-epoch propagation', () => {
    const tle = parseTlePair('VANGUARD 1', SAT5_L1, SAT5_L2);
    const atTime = propagateToTime(satrecFor(tle), tle.epochMs + 360 * 60_000);
    const atMinutes = propagateMinutesSinceEpoch(satrec, 360);
    if (!atTime.ok || !atMinutes.ok) throw new Error('propagation failed');
    // A JS Date has 1 ms resolution, so the absolute-time path can be up to
    // 1 ms off the exact epoch offset: ~7 m at 7 km/s. Allow 10 m.
    expect(atTime.state.positionKm.x).toBeCloseTo(atMinutes.state.positionKm.x, 1);
    expect(atTime.state.positionKm.y).toBeCloseTo(atMinutes.state.positionKm.y, 1);
    expect(atTime.state.positionKm.z).toBeCloseTo(atMinutes.state.positionKm.z, 1);
  });

  it('caches SatRecs per TLE record object', () => {
    const tle = parseTlePair('VANGUARD 1', SAT5_L1, SAT5_L2);
    expect(satrecFor(tle)).toBe(satrecFor(tle));
    expect(satrecFor({ ...tle })).not.toBe(satrecFor(tle));
  });

  it('reports decay instead of returning a position', () => {
    // Propagating a LEO element set decades past its epoch drives it below the surface.
    const iss = createSatrec({
      line1: '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
      line2: '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
    });
    const result = propagateMinutesSinceEpoch(iss, 60 * 24 * 365 * 30);
    expect(result.ok).toBe(false);
  });
});
