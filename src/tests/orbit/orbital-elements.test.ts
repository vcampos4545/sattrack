import { describe, expect, it } from 'vitest';
import { orbitalElements, semiMajorAxisFromMeanMotion, WGS72_RADIUS_KM } from '../../core/orbit/orbital-elements';
import { createSatrec } from '../../core/orbit/sgp4';

// ISS element set, 2019-06-05 (same as tle-parser.test.ts).
const ISS = {
  line1: '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  line2: '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
};

describe('semiMajorAxisFromMeanMotion', () => {
  it('gives the geostationary radius for one sidereal day', () => {
    const n = (2 * Math.PI) / 86164.0905;
    expect(semiMajorAxisFromMeanMotion(n)).toBeCloseTo(42164, -1);
  });
});

describe('orbitalElements (ISS)', () => {
  const el = orbitalElements(createSatrec(ISS));

  it('reads the angular elements from the TLE', () => {
    expect(el.inclinationDeg).toBeCloseTo(51.6433, 4);
    expect(el.raanDeg).toBeCloseTo(59.2583, 4);
    expect(el.eccentricity).toBeCloseTo(0.0008217, 9);
    expect(el.argPerigeeDeg).toBeCloseTo(16.4489, 4);
    expect(el.meanAnomalyDeg).toBeCloseTo(347.6017, 4);
    expect(el.bstar).toBeCloseTo(0.59442e-4, 10);
    expect(new Date(el.epochMs).toISOString().slice(0, 19)).toBe('2019-06-05T12:12:58');
  });

  it('derives period, semi-major axis and apsis altitudes from mean motion', () => {
    // Un-Kozai'd mean motion is within ~0.01 rev/day of the TLE value.
    expect(el.meanMotionRevPerDay).toBeCloseTo(15.5117, 1);
    expect(el.periodMin).toBeCloseTo(1440 / el.meanMotionRevPerDay, 9);
    expect(el.periodMin).toBeGreaterThan(92.7);
    expect(el.periodMin).toBeLessThan(93.0);
    // Independent reference: Kepler's third law on the raw TLE mean motion
    // (15.51174618 rev/day, WGS72 mu) gives a = 6791.43 km. SGP4's un-Kozai'd
    // value is ~0.5 km larger. Perigee ~408 km, apogee ~419 km.
    expect(el.semiMajorAxisKm).toBeCloseTo(6791.43, -1);
    expect(Math.abs(el.semiMajorAxisKm - 6791.43)).toBeLessThan(1);
    expect(el.perigeeAltKm).toBeCloseTo(el.semiMajorAxisKm * (1 - 0.0008217) - WGS72_RADIUS_KM, 9);
    expect(el.perigeeAltKm).toBeCloseTo(408.2, 0);
    expect(el.apogeeAltKm).toBeCloseTo(419.4, 0);
    expect(el.apogeeAltKm - el.perigeeAltKm).toBeCloseTo(2 * el.semiMajorAxisKm * 0.0008217, 6);
  });
});
