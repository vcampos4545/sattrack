import { describe, expect, it } from 'vitest';
import { degreesToRadians, ecfToLookAngles } from 'satellite.js';
import { geodeticToEcef } from '../../core/orbit/coordinate-transformations';
import { ecefToEnu, observerEcef, validateObserverLocation } from '../../core/orbit/observer';
import { computeSatelliteState, lookAnglesAt } from '../../core/orbit/satellite-propagator';
import { createSatrec } from '../../core/orbit/sgp4';
import { computeLookAngles, enuToAzEl } from '../../core/orbit/sky-coordinates';
import type { Vec3 } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';

const RAD = 180 / Math.PI;
const boulder: ObserverLocation = { latitudeDeg: 40.015, longitudeDeg: -105.27, altitudeM: 1655, source: 'manual' };

/** Point `distanceKm` from the observer along a local ENU direction. */
function offsetEnu(obs: ObserverLocation, e: number, n: number, u: number): Vec3 {
  const lat = obs.latitudeDeg / RAD;
  const lon = obs.longitudeDeg / RAD;
  const o = observerEcef(obs);
  // Inverse (transpose) of the ECEF -> ENU rotation.
  return {
    x: o.x - Math.sin(lon) * e - Math.sin(lat) * Math.cos(lon) * n + Math.cos(lat) * Math.cos(lon) * u,
    y: o.y + Math.cos(lon) * e - Math.sin(lat) * Math.sin(lon) * n + Math.cos(lat) * Math.sin(lon) * u,
    z: o.z + Math.cos(lat) * n + Math.sin(lat) * u,
  };
}

const still = { x: 0, y: 0, z: 0 };

describe('ENU and look angles', () => {
  it('puts a satellite directly overhead at 90 deg elevation', () => {
    const sat = geodeticToEcef({ latitudeDeg: boulder.latitudeDeg, longitudeDeg: boulder.longitudeDeg, altitudeKm: 500 });
    const look = computeLookAngles({ positionKm: sat, velocityKmS: still }, boulder);
    expect(look.elevationDeg).toBeCloseTo(90, 9);
    expect(look.azimuthDeg).toBe(0); // undefined at the zenith; documented as 0
    expect(look.rangeKm).toBeCloseTo(500 - 1.655, 9);
  });

  it('measures azimuth clockwise from north', () => {
    const cases: Array<[number, number, number]> = [
      [0, 1000, 0], // north
      [1000, 0, 90], // east
      [0, -1000, 180], // south
      [-1000, 0, 270], // west
      [1000, 1000, 45],
    ];
    for (const [e, n, az] of cases) {
      const look = computeLookAngles({ positionKm: offsetEnu(boulder, e, n, 0), velocityKmS: still }, boulder);
      expect(look.azimuthDeg).toBeCloseTo(az, 9);
      expect(look.elevationDeg).toBeCloseTo(0, 9); // on the local horizon
    }
  });

  it('computes elevation from the local vertical', () => {
    const look = computeLookAngles({ positionKm: offsetEnu(boulder, 0, 1000, 1000), velocityKmS: still }, boulder);
    expect(look.elevationDeg).toBeCloseTo(45, 9);
    expect(look.rangeKm).toBeCloseTo(Math.SQRT2 * 1000, 9);
    const below = computeLookAngles({ positionKm: offsetEnu(boulder, 0, 1000, -10), velocityKmS: still }, boulder);
    expect(below.elevationDeg).toBeLessThan(0);
  });

  it('handles a polar observer', () => {
    const pole: ObserverLocation = { latitudeDeg: 90, longitudeDeg: 0, altitudeM: 0, source: 'manual' };
    const overhead = geodeticToEcef({ latitudeDeg: 90, longitudeDeg: 0, altitudeKm: 800 });
    expect(computeLookAngles({ positionKm: overhead, velocityKmS: still }, pole).elevationDeg).toBeCloseTo(90, 9);
    // At the pole with lon 0, local north points over the pole toward lon 180
    // and local east is +y (toward lon 90E).
    const towardEast = geodeticToEcef({ latitudeDeg: 80, longitudeDeg: 90, altitudeKm: 800 });
    expect(computeLookAngles({ positionKm: towardEast, velocityKmS: still }, pole).azimuthDeg).toBeCloseTo(90, 6);
    const towardNorth = geodeticToEcef({ latitudeDeg: 80, longitudeDeg: 180, altitudeKm: 800 });
    const look = computeLookAngles({ positionKm: towardNorth, velocityKmS: still }, pole);
    expect(look.azimuthDeg).toBeCloseTo(0, 6);
    expect(Number.isFinite(look.elevationDeg)).toBe(true);
  });

  it('signs range rate: positive receding, negative approaching, zero tangential', () => {
    const pos = offsetEnu(boulder, 0, 0, 1000);
    const up = { x: pos.x - observerEcef(boulder).x, y: pos.y - observerEcef(boulder).y, z: pos.z - observerEcef(boulder).z };
    const scale = 1 / Math.hypot(up.x, up.y, up.z);
    const unitUp = { x: up.x * scale, y: up.y * scale, z: up.z * scale };
    expect(computeLookAngles({ positionKm: pos, velocityKmS: unitUp }, boulder).rangeRateKmS).toBeCloseTo(1, 9);
    const away = { x: -unitUp.x, y: -unitUp.y, z: -unitUp.z };
    expect(computeLookAngles({ positionKm: pos, velocityKmS: away }, boulder).rangeRateKmS).toBeCloseTo(-1, 9);
    const east = { x: -Math.sin(boulder.longitudeDeg / RAD), y: Math.cos(boulder.longitudeDeg / RAD), z: 0 };
    expect(computeLookAngles({ positionKm: pos, velocityKmS: east }, boulder).rangeRateKmS).toBeCloseTo(0, 9);
  });

  it('ecefToEnu and enuToAzEl are consistent', () => {
    const enu = ecefToEnu(offsetEnu(boulder, 300, -400, 500), boulder);
    expect(enu.eastKm).toBeCloseTo(300, 8);
    expect(enu.northKm).toBeCloseTo(-400, 8);
    expect(enu.upKm).toBeCloseTo(500, 8);
    const { azimuthDeg, elevationDeg } = enuToAzEl(enu);
    expect(azimuthDeg).toBeCloseTo(180 - Math.atan2(300, 400) * RAD, 9);
    expect(elevationDeg).toBeCloseTo(45, 9);
  });

  it('agrees with satellite.js ecfToLookAngles for a real propagated ISS pass geometry', () => {
    const iss = createSatrec({
      line1: '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
      line2: '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
    });
    const t0 = Date.UTC(2019, 5, 5, 12, 0, 0);
    for (let k = 0; k < 24; k++) {
      const t = t0 + k * 7 * 60_000;
      const ours = lookAnglesAt(iss, boulder, t);
      if (!ours) throw new Error('propagation failed');
      // Independent reference: satellite.js's own geodetic + topocentric math.
      const ref = ecfToLookAngles(
        { latitude: degreesToRadians(boulder.latitudeDeg), longitude: degreesToRadians(boulder.longitudeDeg), height: boulder.altitudeM / 1000 },
        satelliteEcef(iss, t),
      );
      expect(ours.elevationDeg).toBeCloseTo(ref.elevation * RAD, 4);
      expect(ours.rangeKm).toBeCloseTo(ref.rangeSat, 2);
      if (ours.elevationDeg < 89) {
        const dAz = Math.abs(((ours.azimuthDeg - ref.azimuth * RAD + 540) % 360) - 180);
        expect(dAz).toBeLessThan(1e-4);
      }
    }
  });
});

describe('validateObserverLocation', () => {
  it('accepts valid ranges and flags each invalid field', () => {
    expect(validateObserverLocation({ latitudeDeg: 90, longitudeDeg: -180, altitudeM: 0 })).toEqual({});
    const errors = validateObserverLocation({ latitudeDeg: 91, longitudeDeg: 200, altitudeM: Number.NaN });
    expect(Object.keys(errors).sort()).toEqual(['altitudeM', 'latitudeDeg', 'longitudeDeg']);
  });
});

function satelliteEcef(satrec: ReturnType<typeof createSatrec>, t: number): Vec3 {
  const s = computeSatelliteState(satrec, t);
  if (!s) throw new Error('propagation failed');
  return s.ecef.positionKm;
}
