import { describe, expect, it } from 'vitest';
import { computeSatelliteState, lookAnglesAt } from '../../core/orbit/satellite-propagator';
import { satrecFor } from '../../core/orbit/sgp4';
import {
  angularSeparationDeg,
  findSkyArc,
  lookAnglesFast,
  parsePassId,
  REFINE_TOLERANCE_MS,
  sampleSkyTrack,
} from '../../core/orbit/sky-track';
import { parseTlePair } from '../../core/orbit/tle-parser';
import type { ObserverLocation } from '../../types/observer';

const ISS = parseTlePair(
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
);
/** Synthetic geostationary set, same as the propagator tests. */
const GEO = parseTlePair(
  'TEST GEO',
  '1 41866U 16071A   26320.50000000 -.00000088  00000-0  00000-0 0  9995',
  '2 41866   0.0500  95.0000 0001000 270.0000  90.0000  1.00271000 30009',
);

const boulder: ObserverLocation = { latitudeDeg: 40.015, longitudeDeg: -105.27, altitudeM: 1655, source: 'manual' };
const iss = satrecFor(ISS);
const MASK = 10;
const opts = { maskDeg: MASK, searchMs: 2 * 86_400_000, scanStepMs: 30_000 };
const elAt = (obs: ObserverLocation, t: number) => lookAnglesAt(iss, obs, t)!.elevationDeg;

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

describe('findSkyArc', () => {
  const pass = findSkyArc(iss, boulder, ISS.noradId, ISS.epochMs, opts);
  if (!pass) throw new Error('expected an ISS pass over Boulder within two days');

  it('refines AOS and LOS onto the elevation mask', () => {
    expect(pass.aosMs).toBeGreaterThan(ISS.epochMs);
    expect(elAt(boulder, pass.aosMs)).toBeGreaterThanOrEqual(MASK - 0.05);
    expect(elAt(boulder, pass.aosMs)).toBeLessThan(MASK + 0.2);
    expect(elAt(boulder, pass.aosMs - 2 * REFINE_TOLERANCE_MS)).toBeLessThan(MASK);
    expect(elAt(boulder, pass.losMs)).toBeGreaterThanOrEqual(MASK - 0.05);
    expect(elAt(boulder, pass.losMs)).toBeLessThan(MASK + 0.2);
    expect(elAt(boulder, pass.losMs + 2 * REFINE_TOLERANCE_MS)).toBeLessThan(MASK);
    expect(pass.durationS).toBeCloseTo((pass.losMs - pass.aosMs) / 1000, 0);
    // A LEO pass above 10 deg lasts minutes, not seconds or hours.
    expect(pass.durationS).toBeGreaterThan(60);
    expect(pass.durationS).toBeLessThan(12 * 60);
  });

  it('finds the true culmination', () => {
    for (const s of pass.track) expect(s.elevationDeg).toBeLessThanOrEqual(pass.maxElevationDeg + 1e-6);
    expect(elAt(boulder, pass.maxElevationMs - 5000)).toBeLessThan(pass.maxElevationDeg);
    expect(elAt(boulder, pass.maxElevationMs + 5000)).toBeLessThan(pass.maxElevationDeg);
    expect(pass.maxElevationMs).toBeGreaterThan(pass.aosMs);
    expect(pass.maxElevationMs).toBeLessThan(pass.losMs);
  });

  it('returns an ordered track spanning AOS to LOS with the shared id format', () => {
    expect(pass.track[0]!.timeMs).toBe(pass.aosMs);
    expect(pass.track.at(-1)!.timeMs).toBe(pass.losMs);
    for (let i = 1; i < pass.track.length; i++) expect(pass.track[i]!.timeMs).toBeGreaterThan(pass.track[i - 1]!.timeMs);
    expect(pass.track.some((s) => s.timeMs === pass.maxElevationMs)).toBe(true);
    expect(pass.id).toBe(`25544-${pass.aosMs}`);
    expect(parsePassId(pass.id)).toEqual({ noradId: 25544, aosMs: pass.aosMs });
    expect(pass.aosAzimuthDeg).toBeCloseTo(pass.track[0]!.azimuthDeg, 6);
  });

  it('returns the same arc when started mid-pass (pass in progress)', () => {
    const mid = findSkyArc(iss, boulder, ISS.noradId, pass.maxElevationMs, opts);
    expect(mid).not.toBeNull();
    expect(Math.abs(mid!.aosMs - pass.aosMs)).toBeLessThanOrEqual(REFINE_TOLERANCE_MS + 1);
    expect(Math.abs(mid!.losMs - pass.losMs)).toBeLessThanOrEqual(REFINE_TOLERANCE_MS + 1);
    expect(mid!.inProgressAtSearchStart).toBe(false);
  });

  it('moves on to the next arc after LOS', () => {
    const next = findSkyArc(iss, boulder, ISS.noradId, pass.losMs + 1000, opts);
    expect(next).not.toBeNull();
    expect(next!.aosMs).toBeGreaterThan(pass.losMs);
  });

  it('returns null for a satellite that never rises above the mask', () => {
    // ISS ground track stays below 51.7 deg latitude; from the south pole
    // it never climbs above 10 deg.
    const pole: ObserverLocation = { latitudeDeg: -90, longitudeDeg: 0, altitudeM: 0, source: 'manual' };
    expect(findSkyArc(iss, pole, ISS.noradId, ISS.epochMs, opts)).toBeNull();
  });

  it('returns null for a geostationary satellite that is always up', () => {
    const geo = satrecFor(GEO);
    const sub = computeSatelliteState(geo, GEO.epochMs)!.geodetic;
    const under: ObserverLocation = { latitudeDeg: 0, longitudeDeg: sub.longitudeDeg, altitudeM: 0, source: 'manual' };
    expect(lookAnglesAt(geo, under, GEO.epochMs)!.elevationDeg).toBeGreaterThan(80);
    expect(findSkyArc(geo, under, GEO.noradId, GEO.epochMs, { ...opts, searchMs: 86_400_000, scanStepMs: 300_000 })).toBeNull();
  });
});

describe('parsePassId', () => {
  it('rejects malformed ids', () => {
    expect(parsePassId('abc')).toBeNull();
    expect(parsePassId('25544-')).toBeNull();
    expect(parsePassId('25544-1700000000000')).toEqual({ noradId: 25544, aosMs: 1700000000000 });
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
