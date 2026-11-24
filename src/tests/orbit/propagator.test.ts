import { describe, expect, it } from 'vitest';
import {
  computeSatelliteState,
  createBatchBuffers,
  orbitalPeriodMin,
  propagateBatch,
  sampleTrajectory,
} from '../../core/orbit/satellite-propagator';
import { satrecFor } from '../../core/orbit/sgp4';
import { parseTlePair } from '../../core/orbit/tle-parser';
import { classifyEpochAge, epochAgeDays, tleEpochToMs } from '../../core/orbit/time-utils';

const ISS = parseTlePair(
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
);

/**
 * Synthetic geostationary element set (inclination 0.05 deg, e = 0.0001,
 * 1.00271 rev/day) with valid checksums. Propagated with SGP4's deep-space
 * (SDP4) branch.
 */
const GEO = parseTlePair(
  'TEST GEO',
  '1 41866U 16071A   26320.50000000 -.00000088  00000-0  00000-0 0  9995',
  '2 41866   0.0500  95.0000 0001000 270.0000  90.0000  1.00271000 30009',
);

describe('computeSatelliteState', () => {
  it('produces a physically plausible ISS state', () => {
    const s = computeSatelliteState(satrecFor(ISS), ISS.epochMs + 30 * 60_000);
    if (!s) throw new Error('propagation failed');
    expect(s.geodetic.altitudeKm).toBeGreaterThan(380);
    expect(s.geodetic.altitudeKm).toBeLessThan(440);
    expect(Math.abs(s.geodetic.latitudeDeg)).toBeLessThanOrEqual(51.7);
    expect(s.inertialSpeedKmS).toBeGreaterThan(7.6);
    expect(s.inertialSpeedKmS).toBeLessThan(7.75);
    // Earth-relative speed is lower than inertial for a prograde orbit.
    const ecefSpeed = Math.hypot(s.ecef.velocityKmS.x, s.ecef.velocityKmS.y, s.ecef.velocityKmS.z);
    expect(ecefSpeed).toBeLessThan(s.inertialSpeedKmS);
  });

  it('keeps a geostationary satellite fixed over the equator for a day', () => {
    const satrec = satrecFor(GEO);
    expect(satrec.method).toBe('d'); // deep-space branch
    const lons: number[] = [];
    for (let h = 0; h <= 24; h += 2) {
      const s = computeSatelliteState(satrec, GEO.epochMs + h * 3_600_000);
      if (!s) throw new Error('propagation failed');
      expect(Math.abs(s.geodetic.latitudeDeg)).toBeLessThan(0.1);
      expect(s.geodetic.altitudeKm).toBeGreaterThan(35_700);
      expect(s.geodetic.altitudeKm).toBeLessThan(35_900);
      lons.push(s.geodetic.longitudeDeg);
    }
    // The sub-satellite longitude stays put (within ~0.5 deg of drift).
    expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(0.5);
  });
});

describe('ground track behavior', () => {
  it('produces wrapped longitudes when the ground track crosses the date line', () => {
    const samples = sampleTrajectory(satrecFor(ISS), ISS.epochMs, ISS.epochMs + 3 * 3_600_000, 30_000);
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!.geodetic.longitudeDeg;
      const b = samples[i]!.geodetic.longitudeDeg;
      expect(a).toBeGreaterThan(-180);
      expect(a).toBeLessThanOrEqual(180);
      // A jump of more than 180 deg between 30 s samples can only be a date-line wrap.
      if (Math.abs(b - a) > 180) crossings++;
    }
    expect(crossings).toBeGreaterThanOrEqual(1);
  });
});

describe('sampleTrajectory', () => {
  it('includes both ends and uses the requested step', () => {
    const start = ISS.epochMs;
    const samples = sampleTrajectory(satrecFor(ISS), start, start + 600_000, 60_000);
    expect(samples).toHaveLength(11);
    expect(samples[0]?.timeMs).toBe(start);
    expect(samples.at(-1)?.timeMs).toBe(start + 600_000);
  });

  it('rejects a non-positive step', () => {
    expect(() => sampleTrajectory(satrecFor(ISS), 0, 1, 0)).toThrow();
  });
});

describe('propagateBatch', () => {
  it('fills TEME buffers that match single propagation and flags failures', () => {
    const t = ISS.epochMs + 600_000;
    const satrecs = [satrecFor(ISS), satrecFor(GEO)];
    const out = createBatchBuffers(satrecs.length);
    expect(propagateBatch(satrecs, t, out)).toBe(2);
    const single = computeSatelliteState(satrecFor(GEO), t);
    expect(out.positionsKm[3]).toBeCloseTo(single!.teme.positionKm.x, 9);
    expect(out.velocitiesKmS[5]).toBeCloseTo(single!.teme.velocityKmS.z, 12);
    expect(Array.from(out.valid)).toEqual([1, 1]);

    // Decades past epoch the ISS elements decay; the slot is flagged invalid.
    const late = ISS.epochMs + 30 * 365 * 86_400_000;
    expect(propagateBatch([satrecFor(ISS)], late, out)).toBe(0);
    expect(out.valid[0]).toBe(0);
  });
});

describe('time utilities', () => {
  it('derives the orbital period from mean motion', () => {
    expect(orbitalPeriodMin(satrecFor(ISS))).toBeCloseTo(ISS.periodMin, 1);
  });

  it('classifies element-set age in both directions', () => {
    const epoch = tleEpochToMs(26, 300);
    expect(epochAgeDays(epoch, epoch + 86_400_000)).toBe(1);
    expect(classifyEpochAge(epoch, epoch + 86_400_000)).toBe('fresh');
    expect(classifyEpochAge(epoch, epoch + 5 * 86_400_000)).toBe('aging');
    expect(classifyEpochAge(epoch, epoch + 30 * 86_400_000)).toBe('stale');
    expect(classifyEpochAge(epoch, epoch - 30 * 86_400_000)).toBe('stale');
  });

  it('converts local-time-free UTC epochs regardless of the host time zone', () => {
    expect(new Date(tleEpochToMs(0, 1)).toISOString()).toBe('2000-01-01T00:00:00.000Z');
    expect(new Date(tleEpochToMs(56, 366.5)).toISOString()).toBe('2056-12-31T12:00:00.000Z');
    expect(new Date(tleEpochToMs(57, 1)).toISOString()).toBe('1957-01-01T00:00:00.000Z');
  });
});
