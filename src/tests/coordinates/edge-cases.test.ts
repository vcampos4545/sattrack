/**
 * Spec section 15 edge cases that cut across modules: the date line, the
 * horizon, the zenith, polar observers, geostationary geometry and a
 * satellite passing overhead right now. Single-module edge cases live next to
 * their module's tests (footprint, ground track, pass prediction).
 */
import { describe, expect, it } from 'vitest';
import { WGS84_A_KM } from '../../core/orbit/constants';
import { geodeticToEcef } from '../../core/orbit/coordinate-transformations';
import { observerFootprintVisibility } from '../../core/orbit/footprint';
import { observerEcef } from '../../core/orbit/observer';
import { currentOrNextPass, isPassInProgress, predictPasses } from '../../core/orbit/pass-prediction';
import { computeSatelliteState, lookAnglesAt } from '../../core/orbit/satellite-propagator';
import { satrecFor } from '../../core/orbit/sgp4';
import { computeLookAngles } from '../../core/orbit/sky-coordinates';
import { parseTlePair } from '../../core/orbit/tle-parser';
import type { Vec3 } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';

const RAD = 180 / Math.PI;
const still = { x: 0, y: 0, z: 0 };

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

const obs = (latitudeDeg: number, longitudeDeg: number, altitudeM = 0): ObserverLocation => ({
  latitudeDeg,
  longitudeDeg,
  altitudeM,
  source: 'manual',
});

/** Point displaced from the observer along local east/north/up, km. */
function offsetEnu(o: ObserverLocation, e: number, n: number, u: number): Vec3 {
  const lat = o.latitudeDeg / RAD;
  const lon = o.longitudeDeg / RAD;
  const p = observerEcef(o);
  return {
    x: p.x - Math.sin(lon) * e - Math.sin(lat) * Math.cos(lon) * n + Math.cos(lat) * Math.cos(lon) * u,
    y: p.y + Math.cos(lon) * e - Math.sin(lat) * Math.sin(lon) * n + Math.cos(lat) * Math.sin(lon) * u,
    z: p.z + Math.cos(lat) * n + Math.sin(lat) * u,
  };
}

/** Spherical-Earth elevation of a satellite at radius r seen across central angle gamma. */
function sphericalElevationDeg(gammaDeg: number, rKm: number, earthKm = WGS84_A_KM): number {
  const g = gammaDeg / RAD;
  return Math.atan2(Math.cos(g) - earthKm / rKm, Math.sin(g)) * RAD;
}

describe('International Date Line', () => {
  it('sees a satellite just across the line to the east at azimuth ~90, not ~270', () => {
    const sat = geodeticToEcef({ latitudeDeg: 0, longitudeDeg: -179.5, altitudeKm: 500 });
    const look = computeLookAngles({ positionKm: sat, velocityKmS: still }, obs(0, 179.5));
    expect(look.azimuthDeg).toBeGreaterThan(85);
    expect(look.azimuthDeg).toBeLessThan(95);
    expect(look.elevationDeg).toBeGreaterThan(70);
  });

  it('sees a satellite just across the line to the west at azimuth ~270', () => {
    const sat = geodeticToEcef({ latitudeDeg: 0, longitudeDeg: 179.5, altitudeKm: 500 });
    const look = computeLookAngles({ positionKm: sat, velocityKmS: still }, obs(0, -179.5));
    expect(look.azimuthDeg).toBeGreaterThan(265);
    expect(look.azimuthDeg).toBeLessThan(275);
  });

  it('gives identical look angles for an observer entered as +180 or -180', () => {
    const t = ISS.epochMs + 3_600_000;
    const a = lookAnglesAt(satrecFor(ISS), obs(-15, 180), t)!;
    const b = lookAnglesAt(satrecFor(ISS), obs(-15, -180), t)!;
    expect(a.azimuthDeg).toBeCloseTo(b.azimuthDeg, 9);
    expect(a.elevationDeg).toBeCloseTo(b.elevationDeg, 9);
    expect(a.rangeKm).toBeCloseTo(b.rangeKm, 9);
  });
});

describe('near the horizon', () => {
  const o = obs(40, -105, 1600);

  it('puts a point on the local horizontal plane at 0 deg elevation', () => {
    const look = computeLookAngles({ positionKm: offsetEnu(o, 1000, 1000, 0), velocityKmS: still }, o);
    expect(look.elevationDeg).toBeCloseTo(0, 9);
    expect(look.azimuthDeg).toBeCloseTo(45, 9);
  });

  it('reports small negative elevations below the horizon instead of clamping', () => {
    const look = computeLookAngles({ positionKm: offsetEnu(o, 0, 2000, -10), velocityKmS: still }, o);
    expect(look.elevationDeg).toBeCloseTo(-Math.atan2(10, 2000) * RAD, 9);
  });

  it('finds a grazing pass whose peak barely clears the mask, and drops it when the mask is above the peak', () => {
    const boulder = obs(40.015, -105.27, 1655);
    const base = { startMs: ISS.epochMs, maxPasses: 1, searchDays: 1, scanStepS: 30 };
    const [low] = predictPasses(satrecFor(ISS), boulder, { ...base, elevationMaskDeg: 0 }).passes;
    expect(low).toBeDefined();
    const peak = low!.maxElevationDeg;

    const graze = predictPasses(satrecFor(ISS), boulder, { ...base, elevationMaskDeg: peak - 0.05 }).passes[0]!;
    expect(Math.abs(graze.maxElevationMs - low!.maxElevationMs)).toBeLessThan(2000);
    expect(graze.maxElevationDeg).toBeCloseTo(peak, 3);
    // 0.05 deg below the peak: tens of seconds, far shorter than the 30 s grid could resolve alone.
    expect(graze.durationS).toBeLessThan(90);
    expect(graze.durationS).toBeGreaterThan(0);

    const missed = predictPasses(satrecFor(ISS), boulder, {
      ...base,
      startMs: low!.aosMs - 60_000,
      searchDays: (low!.losMs - low!.aosMs + 120_000) / 86_400_000,
      elevationMaskDeg: peak + 0.05,
    });
    expect(missed.passes).toHaveLength(0);
  });
});

describe('satellite directly overhead, pass in progress', () => {
  // Put the observer under the ISS sub-satellite point at t, then search from t.
  const t = ISS.epochMs + 5_400_000;
  const sub = computeSatelliteState(satrecFor(ISS), t)!.geodetic;
  const under = obs(sub.latitudeDeg, sub.longitudeDeg);

  it('is at ~90 deg elevation from the sub-satellite point', () => {
    const look = lookAnglesAt(satrecFor(ISS), under, t)!;
    expect(look.elevationDeg).toBeGreaterThan(89.9);
    expect(look.rangeKm).toBeCloseTo(sub.altitudeKm, 0);
  });

  it('reports the current pass with its real AOS before the search start', () => {
    const { passes, status } = predictPasses(satrecFor(ISS), under, {
      startMs: t,
      elevationMaskDeg: 10,
      maxPasses: 3,
      searchDays: 1,
      scanStepS: 30,
    });
    expect(status).toBe('ok');
    const first = passes[0]!;
    expect(first.aosMs).toBeLessThan(t);
    expect(first.losMs).toBeGreaterThan(t);
    expect(isPassInProgress(first, t)).toBe(true);
    expect(currentOrNextPass(passes, t)).toBe(first);
    expect(first.maxElevationDeg).toBeGreaterThan(89);
    expect(Math.abs(first.maxElevationMs - t)).toBeLessThan(5000);
  });
});

describe('polar observers', () => {
  it('cannot see a geostationary satellite from the North Pole (about -8.7 deg)', () => {
    const t = GEO.epochMs;
    const state = computeSatelliteState(satrecFor(GEO), t)!;
    const r = Math.hypot(state.ecef.positionKm.x, state.ecef.positionKm.y, state.ecef.positionKm.z);
    const look = lookAnglesAt(satrecFor(GEO), obs(90, 0), t)!;
    // Spherical estimate with the polar radius; the geodetic vertical at the pole is the spin axis.
    expect(look.elevationDeg).toBeCloseTo(sphericalElevationDeg(90, r, 6356.752), 1);
    expect(look.elevationDeg).toBeLessThan(-8);
    const result = predictPasses(satrecFor(GEO), obs(90, 0), {
      startMs: t,
      elevationMaskDeg: 0,
      maxPasses: 5,
      searchDays: 2,
      scanStepS: 60,
    });
    expect(result.status).toBe('never-above-mask');
  });

  it('puts an observer at the pole inside the footprint of a satellite over the pole', () => {
    const sat = geodeticToEcef({ latitudeDeg: 88, longitudeDeg: 30, altitudeKm: 850 });
    const vis = observerFootprintVisibility(sat, obs(90, -120), 10);
    expect(vis.inside).toBe(true);
    expect(vis.elevationDeg).toBeGreaterThan(70);
  });
});

describe('geostationary look angles', () => {
  const t = GEO.epochMs;
  const state = computeSatelliteState(satrecFor(GEO), t)!;
  const r = Math.hypot(state.ecef.positionKm.x, state.ecef.positionKm.y, state.ecef.positionKm.z);
  const lon = state.geodetic.longitudeDeg;

  it('is at the zenith from the sub-satellite point on the equator', () => {
    expect(lookAnglesAt(satrecFor(GEO), obs(0, lon), t)!.elevationDeg).toBeGreaterThan(89.5);
  });

  it('sits due south at the spherical-Earth elevation from 45 N on the same meridian', () => {
    const look = lookAnglesAt(satrecFor(GEO), obs(45, lon), t)!;
    expect(look.azimuthDeg).toBeCloseTo(180, 0);
    // Geodetic vs geocentric latitude and oblateness move this by a few tenths of a degree.
    expect(Math.abs(look.elevationDeg - sphericalElevationDeg(45, r))).toBeLessThan(0.5);
  });

  it('sits due north from the southern hemisphere', () => {
    const look = lookAnglesAt(satrecFor(GEO), obs(-30, lon), t)!;
    expect(Math.abs(look.azimuthDeg - 0) < 1 || Math.abs(look.azimuthDeg - 360) < 1).toBe(true);
    expect(look.elevationDeg).toBeGreaterThan(50);
  });
});
