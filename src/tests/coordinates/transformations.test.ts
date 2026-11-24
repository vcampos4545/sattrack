import { describe, expect, it } from 'vitest';
import { gstime } from 'satellite.js';
import { WGS84_A_KM, WGS84_B_KM } from '../../core/orbit/constants';
import {
  ecefPositionToTeme,
  ecefToGeodetic,
  geodeticToEcef,
  normalizeDegrees360,
  temePositionToEcef,
  temeToEcef,
  wrapLongitudeDeg,
} from '../../core/orbit/coordinate-transformations';
import { gmstRad, msToJulianDate } from '../../core/orbit/time-utils';

const RAD = 180 / Math.PI;

describe('gmstRad (IAU 1982)', () => {
  it('matches Vallado Example 3-5: 1992-08-20 12:14:00 UT1 -> 152.578787810 deg', () => {
    expect(gmstRad(Date.UTC(1992, 7, 20, 12, 14, 0)) * RAD).toBeCloseTo(152.57878781, 7);
  });

  it('agrees with satellite.js gstime over several decades', () => {
    for (const ms of [Date.UTC(1980, 0, 1), Date.UTC(2004, 3, 6, 7, 51, 28), Date.UTC(2026, 10, 24, 19, 0, 0)]) {
      expect(gmstRad(ms)).toBeCloseTo(gstime(msToJulianDate(ms)), 10);
    }
  });
});

/**
 * Vallado, "Revisiting Spacetrack Report #3", Appendix C example:
 * 2004-04-06 07:51:28.386009 UTC, UT1 - UTC = -0.4399619 s.
 */
describe('TEME -> ECEF (PEF) against Vallado reference', () => {
  const teme = {
    positionKm: { x: 5094.1801621, y: 6127.6446595, z: 6380.3445327 },
    velocityKmS: { x: -4.746131487, y: 0.785818041, z: 5.531931288 },
  };
  const utcMs = Date.UTC(2004, 3, 6, 7, 51, 28) + 386.009;
  const ut1Ms = utcMs - 439.9619;

  it('reproduces r_PEF and v_PEF when given UT1', () => {
    const ecef = temeToEcef(teme, gmstRad(ut1Ms));
    expect(ecef.positionKm.x).toBeCloseTo(-1033.4750313, 5);
    expect(ecef.positionKm.y).toBeCloseTo(7901.3055856, 5);
    expect(ecef.positionKm.z).toBeCloseTo(6380.3445327, 6);
    expect(ecef.velocityKmS.x).toBeCloseTo(-3.225632747, 7);
    expect(ecef.velocityKmS.y).toBeCloseTo(-2.872442511, 7);
    expect(ecef.velocityKmS.z).toBeCloseTo(5.531931288, 9);
  });

  it('stays within the documented 0.5 km error budget of r_ITRF when using UTC as UT1', () => {
    // r_ITRF includes polar motion, which this app does not model.
    const itrf = { x: -1033.479383, y: 7901.2952754, z: 6380.3565958 };
    const r = temeToEcef(teme, gmstRad(utcMs)).positionKm;
    expect(Math.hypot(r.x - itrf.x, r.y - itrf.y, r.z - itrf.z)).toBeLessThan(0.5);
  });

  it('round-trips positions through the inverse rotation', () => {
    const g = 1.234;
    const back = ecefPositionToTeme(temePositionToEcef(teme.positionKm, g), g);
    expect(back.x).toBeCloseTo(teme.positionKm.x, 9);
    expect(back.y).toBeCloseTo(teme.positionKm.y, 9);
    expect(back.z).toBeCloseTo(teme.positionKm.z, 9);
  });
});

describe('geodetic conversions (WGS84)', () => {
  it('matches Vallado Example 3-3 (ECEF -> geodetic)', () => {
    const g = ecefToGeodetic({ x: 6524.834, y: 6862.875, z: 6448.296 });
    expect(g.latitudeDeg).toBeCloseTo(34.352496, 5);
    expect(g.longitudeDeg).toBeCloseTo(46.4464, 4);
    expect(g.altitudeKm).toBeCloseTo(5085.22, 2);
  });

  it('places reference points on the ellipsoid', () => {
    const origin = geodeticToEcef({ latitudeDeg: 0, longitudeDeg: 0, altitudeKm: 0 });
    expect(origin.x).toBeCloseTo(WGS84_A_KM, 9);
    expect(origin.y).toBeCloseTo(0, 9);
    expect(origin.z).toBeCloseTo(0, 9);
    const east = geodeticToEcef({ latitudeDeg: 0, longitudeDeg: 90, altitudeKm: 0 });
    expect(east.y).toBeCloseTo(WGS84_A_KM, 9);
    const pole = geodeticToEcef({ latitudeDeg: 90, longitudeDeg: 0, altitudeKm: 0 });
    expect(pole.z).toBeCloseTo(WGS84_B_KM, 9);
  });

  it('handles the poles exactly', () => {
    const north = ecefToGeodetic({ x: 0, y: 0, z: WGS84_B_KM + 400 });
    expect(north.latitudeDeg).toBeCloseTo(90, 10);
    expect(north.altitudeKm).toBeCloseTo(400, 8);
    const south = ecefToGeodetic({ x: 0, y: 0, z: -WGS84_B_KM });
    expect(south.latitudeDeg).toBeCloseTo(-90, 10);
    expect(south.altitudeKm).toBeCloseTo(0, 8);
  });

  it('round-trips geodetic -> ECEF -> geodetic across the globe and altitudes', () => {
    for (const lat of [-90, -89.999, -45, -0.001, 0, 12.5, 60, 89.999, 90]) {
      for (const lon of [-180, -179.999, -90, 0, 45, 179.999, 180]) {
        for (const alt of [-0.4, 0, 420, 20200, 35786]) {
          const g = ecefToGeodetic(geodeticToEcef({ latitudeDeg: lat, longitudeDeg: lon, altitudeKm: alt }));
          expect(g.latitudeDeg).toBeCloseTo(lat, 8);
          expect(g.altitudeKm).toBeCloseTo(alt, 6);
          // Longitude is meaningless at the poles; elsewhere compare wrapped values.
          if (Math.abs(lat) < 90) expect(g.longitudeDeg).toBeCloseTo(wrapLongitudeDeg(lon), 8);
        }
      }
    }
  });

  it('keeps longitude continuous across the International Date Line', () => {
    const west = ecefToGeodetic(geodeticToEcef({ latitudeDeg: 10, longitudeDeg: 179.9, altitudeKm: 500 }));
    const east = ecefToGeodetic(geodeticToEcef({ latitudeDeg: 10, longitudeDeg: -179.9, altitudeKm: 500 }));
    expect(west.longitudeDeg).toBeCloseTo(179.9, 8);
    expect(east.longitudeDeg).toBeCloseTo(-179.9, 8);
  });
});

describe('angle wrapping', () => {
  it('wraps longitudes into (-180, 180]', () => {
    expect(wrapLongitudeDeg(0)).toBe(0);
    expect(wrapLongitudeDeg(180)).toBe(180);
    expect(wrapLongitudeDeg(-180)).toBe(180);
    expect(wrapLongitudeDeg(190)).toBeCloseTo(-170, 12);
    expect(wrapLongitudeDeg(-190)).toBeCloseTo(170, 12);
    expect(wrapLongitudeDeg(540)).toBe(180);
    expect(wrapLongitudeDeg(359.5)).toBeCloseTo(-0.5, 12);
    expect(wrapLongitudeDeg(-720.25)).toBeCloseTo(-0.25, 12);
  });

  it('normalizes azimuths into [0, 360)', () => {
    expect(normalizeDegrees360(-90)).toBe(270);
    expect(normalizeDegrees360(360)).toBe(0);
    expect(normalizeDegrees360(725)).toBe(5);
    expect(normalizeDegrees360(-1e-15)).toBeLessThan(360);
  });
});
