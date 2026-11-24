import { describe, expect, it } from 'vitest';
import { extrapolateTwoBody, MAX_EXTRAPOLATION_S } from '../../core/orbit/extrapolation';
import { createBatchBuffers, propagateBatch } from '../../core/orbit/satellite-propagator';
import { satrecFor } from '../../core/orbit/sgp4';
import { parseTlePair } from '../../core/orbit/tle-parser';

const ISS = parseTlePair(
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
);

/** Error (km) of extrapolating dt seconds from t0, against SGP4 evaluated at t0 + dt. */
function errorKm(dtS: number): number {
  const satrec = satrecFor(ISS);
  const t0 = ISS.epochMs + 3_600_000;
  const a = createBatchBuffers(1);
  const b = createBatchBuffers(1);
  propagateBatch([satrec], t0, a);
  propagateBatch([satrec], t0 + dtS * 1000, b);
  const out = [0, 0, 0];
  extrapolateTwoBody(a.positionsKm, a.velocitiesKmS, 0, dtS, out);
  return Math.hypot(out[0]! - b.positionsKm[0]!, out[1]! - b.positionsKm[1]!, out[2]! - b.positionsKm[2]!);
}

describe('extrapolateTwoBody', () => {
  it('is exact at dt = 0', () => {
    expect(errorKm(0)).toBe(0);
  });

  it('tracks SGP4 to meters over one second (one 1 Hz propagation interval)', () => {
    expect(errorKm(1)).toBeLessThan(0.001);
  });

  it('stays within ~50 m over 20 s, the re-propagation threshold, in both directions', () => {
    expect(errorKm(20)).toBeLessThan(0.05);
    expect(errorKm(-20)).toBeLessThan(0.05);
  });

  it('stays under 1 km at the maximum extrapolation span', () => {
    expect(errorKm(MAX_EXTRAPOLATION_S)).toBeLessThan(1);
  });

  it('beats straight-line extrapolation by orders of magnitude', () => {
    // A straight line drifts ~0.5 * 8.7e-3 km/s^2 * 60^2 = 15.7 km in 60 s.
    expect(errorKm(60)).toBeLessThan(0.3);
  });
});
