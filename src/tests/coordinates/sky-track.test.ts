import { describe, expect, it } from 'vitest';
import { lookAnglesAt } from '../../core/orbit/satellite-propagator';
import { satrecFor } from '../../core/orbit/sgp4';
import { angularSeparationDeg, lookAnglesFast, sampleSkyTrack } from '../../core/orbit/sky-track';
import { parseTlePair } from '../../core/orbit/tle-parser';
import type { ObserverLocation } from '../../types/observer';

const ISS = parseTlePair(
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
);
const boulder: ObserverLocation = { latitudeDeg: 40.015, longitudeDeg: -105.27, altitudeM: 1655, source: 'manual' };
const iss = satrecFor(ISS);

describe('lookAnglesFast', () => {
  it('matches lookAnglesAt exactly', () => {
    for (const dt of [0, 600_000, 3_600_000]) {
      const t = ISS.epochMs + dt;
      expect(lookAnglesFast(iss, boulder, t)).toEqual(lookAnglesAt(iss, boulder, t));
    }
  });
});

describe('sampleSkyTrack', () => {
  it('samples both ends inclusive at the given step', () => {
    const track = sampleSkyTrack(iss, boulder, ISS.epochMs, ISS.epochMs + 60_000, 20_000);
    expect(track.map((s) => s.timeMs - ISS.epochMs)).toEqual([0, 20_000, 40_000, 60_000]);
    expect(() => sampleSkyTrack(iss, boulder, 0, 1, 0)).toThrow();
  });
});

describe('angularSeparationDeg', () => {
  it('is 0 for identical directions and symmetric', () => {
    expect(angularSeparationDeg({ azimuthDeg: 123, elevationDeg: 45 }, { azimuthDeg: 123, elevationDeg: 45 })).toBe(0);
    const a = { azimuthDeg: 10, elevationDeg: 20 };
    const b = { azimuthDeg: 50, elevationDeg: 60 };
    expect(angularSeparationDeg(a, b)).toBeCloseTo(angularSeparationDeg(b, a), 12);
  });

  it('matches known geometry on the horizon and to the zenith', () => {
    expect(angularSeparationDeg({ azimuthDeg: 0, elevationDeg: 0 }, { azimuthDeg: 90, elevationDeg: 0 })).toBeCloseTo(90, 9);
    expect(angularSeparationDeg({ azimuthDeg: 0, elevationDeg: 0 }, { azimuthDeg: 180, elevationDeg: 0 })).toBeCloseTo(180, 9);
    expect(angularSeparationDeg({ azimuthDeg: 359, elevationDeg: 0 }, { azimuthDeg: 1, elevationDeg: 0 })).toBeCloseTo(2, 9);
    expect(angularSeparationDeg({ azimuthDeg: 200, elevationDeg: 90 }, { azimuthDeg: 0, elevationDeg: 30 })).toBeCloseTo(60, 9);
  });

  it('stays small near the zenith even for large azimuth differences', () => {
    // 180 deg apart in azimuth, both 0.5 deg from the zenith: 1 deg apart.
    expect(angularSeparationDeg({ azimuthDeg: 0, elevationDeg: 89.5 }, { azimuthDeg: 180, elevationDeg: 89.5 })).toBeCloseTo(1, 9);
  });
});
