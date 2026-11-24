import { describe, expect, it } from 'vitest';
import { WGS84_A_KM } from '../../core/orbit/constants';
import { geodeticToEcef, vecMagnitude } from '../../core/orbit/coordinate-transformations';
import { computeFootprint, footprintCentralAngleRad, observerFootprintVisibility } from '../../core/orbit/footprint';
import { computeLookAngles } from '../../core/orbit/sky-coordinates';
import type { Geodetic } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';

const RAD = 180 / Math.PI;
const still = { x: 0, y: 0, z: 0 };

const at = (latitudeDeg: number, longitudeDeg: number, altitudeKm: number) =>
  geodeticToEcef({ latitudeDeg, longitudeDeg, altitudeKm });

const ground = (g: Geodetic, altitudeM = 0): ObserverLocation => ({
  latitudeDeg: g.latitudeDeg,
  longitudeDeg: g.longitudeDeg,
  altitudeM,
  source: 'manual',
});

/** Elevation of the satellite from each boundary point, via the shared look-angle code. */
function boundaryElevations(satEcef: ReturnType<typeof at>, boundary: Geodetic[]): number[] {
  return boundary.map((b) => computeLookAngles({ positionKm: satEcef, velocityKmS: still }, ground(b)).elevationDeg);
}

/** Great-circle angle between two geodetic points on a unit sphere, degrees. */
function centralAngleDeg(a: Geodetic, b: Geodetic): number {
  const p1 = a.latitudeDeg / RAD;
  const p2 = b.latitudeDeg / RAD;
  const dl = (b.longitudeDeg - a.longitudeDeg) / RAD;
  return Math.acos(Math.min(1, Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl))) * RAD;
}

describe('footprintCentralAngleRad', () => {
  it('equals acos(R / r) at zero elevation (geometric horizon)', () => {
    const R = 6378.137;
    expect(footprintCentralAngleRad(R + 420, R, 0)).toBeCloseTo(Math.acos(R / (R + 420)), 12);
    // Geostationary: ~81.3 deg.
    expect(footprintCentralAngleRad(42_164, R, 0) * RAD).toBeCloseTo(81.3, 1);
  });

  it('matches lambda = 90 - e - asin(R cos e / r)', () => {
    const R = 6378.137;
    const r = R + 800;
    const e = 10;
    const expected = 90 - e - Math.asin((R / r) * Math.cos(e / RAD)) * RAD;
    expect(footprintCentralAngleRad(r, R, e) * RAD).toBeCloseTo(expected, 12);
  });

  it('shrinks as the minimum elevation grows and vanishes at the surface', () => {
    const R = 6378.137;
    const a0 = footprintCentralAngleRad(R + 500, R, 0);
    const a10 = footprintCentralAngleRad(R + 500, R, 10);
    const a45 = footprintCentralAngleRad(R + 500, R, 45);
    expect(a10).toBeLessThan(a0);
    expect(a45).toBeLessThan(a10);
    expect(footprintCentralAngleRad(R, R, 0)).toBe(0);
    expect(footprintCentralAngleRad(R - 1, R, 0)).toBe(0);
  });
});

describe('computeFootprint', () => {
  it('puts every boundary point exactly on the minimum-elevation contour', () => {
    for (const [lat, lon, alt, elev] of [
      [30, -100, 420, 0],
      [51, 10, 420, 10],
      [-45, 140, 800, 25],
      [0, 0, 20_200, 15], // GPS altitude
    ] as const) {
      const sat = at(lat, lon, alt);
      const fp = computeFootprint(sat, elev, 72)!;
      expect(fp.boundary).toHaveLength(72);
      for (const e of boundaryElevations(sat, fp.boundary)) expect(e).toBeCloseTo(elev, 6);
    }
  });

  it('agrees with the spherical central angle to within the Earth oblateness', () => {
    const sat = at(20, 30, 420);
    const fp = computeFootprint(sat, 0)!;
    const spherical = footprintCentralAngleRad(vecMagnitude(sat), WGS84_A_KM, 0) * RAD;
    // ISS horizon footprint: ~20 deg, ~2200 km radius.
    expect(fp.centralAngleDeg).toBeGreaterThan(19.5);
    expect(fp.centralAngleDeg).toBeLessThan(21);
    expect(Math.abs(fp.centralAngleDeg - spherical)).toBeLessThan(0.3);
    expect(fp.groundRadiusKm).toBeGreaterThan(2150);
    expect(fp.groundRadiusKm).toBeLessThan(2350);
    // Every boundary point is ~lambda from the sub-satellite point.
    for (const b of fp.boundary) expect(Math.abs(centralAngleDeg(fp.subSatellite, b) - fp.centralAngleDeg)).toBeLessThan(0.3);
  });

  it('covers ~81 deg of central angle for a geostationary satellite at zero elevation', () => {
    const sat = at(0, -75, 35_786);
    const fp = computeFootprint(sat, 0)!;
    expect(fp.centralAngleDeg).toBeGreaterThan(80.8);
    expect(fp.centralAngleDeg).toBeLessThan(81.7);
    for (const e of boundaryElevations(sat, fp.boundary)) expect(e).toBeCloseTo(0, 6);
    // The footprint reaches ~81 deg latitude north and south of the equator.
    const lats = fp.boundary.map((b) => b.latitudeDeg);
    expect(Math.max(...lats)).toBeGreaterThan(80);
    expect(Math.min(...lats)).toBeLessThan(-80);
  });

  it('shrinks as the minimum elevation grows', () => {
    const sat = at(10, 10, 550);
    const angles = [0, 10, 30, 60, 85].map((e) => computeFootprint(sat, e)!.centralAngleDeg);
    for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeLessThan(angles[i - 1]!);
    // 85 deg mask at 550 km: lambda = 5 - asin((R/r) cos 85) ~ 0.4 deg.
    expect(angles.at(-1)).toBeLessThan(0.5);
  });

  it('wraps across the date line', () => {
    const sat = at(0, 179, 420);
    const fp = computeFootprint(sat, 0)!;
    const lons = fp.boundary.map((b) => b.longitudeDeg);
    expect(lons.some((l) => l < -170)).toBe(true);
    expect(lons.some((l) => l > 170)).toBe(true);
    for (const l of lons) {
      expect(l).toBeGreaterThan(-180);
      expect(l).toBeLessThanOrEqual(180);
    }
    for (const e of boundaryElevations(sat, fp.boundary)) expect(e).toBeCloseTo(0, 6);
  });

  it('handles a satellite directly over a pole', () => {
    const sat = at(90, 0, 850);
    const fp = computeFootprint(sat, 5, 36)!;
    expect(fp.subSatellite.latitudeDeg).toBeCloseTo(90, 9);
    const lats = fp.boundary.map((b) => b.latitudeDeg);
    // Symmetric about the pole: one ring of latitude.
    expect(Math.max(...lats) - Math.min(...lats)).toBeLessThan(1e-6);
    // The ring goes all the way around in longitude, not along one meridian.
    const lons = new Set(fp.boundary.map((b) => b.longitudeDeg.toFixed(3)));
    expect(lons.size).toBe(36);
    for (const e of boundaryElevations(sat, fp.boundary)) expect(e).toBeCloseTo(5, 6);
    expect(observerFootprintVisibility(sat, ground({ latitudeDeg: 90, longitudeDeg: 0, altitudeKm: 0 }), 5).inside).toBe(true);
  });

  it('contains the pole when a polar orbiter is near it', () => {
    const sat = at(80, 45, 850);
    const pole = ground({ latitudeDeg: 90, longitudeDeg: 0, altitudeKm: 0 });
    expect(observerFootprintVisibility(sat, pole, 0).inside).toBe(true);
    const fp = computeFootprint(sat, 0)!;
    // The boundary wraps around the pole: longitudes span the whole circle.
    const lons = fp.boundary.map((b) => b.longitudeDeg);
    expect(Math.max(...lons) - Math.min(...lons)).toBeGreaterThan(300);
  });

  it('returns null for positions at or below the surface and for bad input', () => {
    expect(computeFootprint(at(0, 0, -1), 0)).toBeNull();
    expect(computeFootprint({ x: Number.NaN, y: 0, z: 0 }, 0)).toBeNull();
    expect(computeFootprint(at(0, 0, 400), Number.NaN)).toBeNull();
  });
});

describe('observerFootprintVisibility', () => {
  const sat = at(40, -100, 420);
  it('is inside directly below the satellite', () => {
    const v = observerFootprintVisibility(sat, ground({ latitudeDeg: 40, longitudeDeg: -100, altitudeKm: 0 }, 1600), 10);
    expect(v.inside).toBe(true);
    expect(v.elevationDeg).toBeCloseTo(90, 6);
  });

  it('agrees with the computed boundary just inside and just outside', () => {
    const fp = computeFootprint(sat, 10, 16)!;
    for (const b of fp.boundary) {
      // Nudge 0.05 deg toward / away from the sub-satellite point along the meridian-ish direction.
      const toward = { ...b, latitudeDeg: b.latitudeDeg + (fp.subSatellite.latitudeDeg - b.latitudeDeg) * 0.01, longitudeDeg: b.longitudeDeg + (fp.subSatellite.longitudeDeg - b.longitudeDeg) * 0.01 };
      const away = { ...b, latitudeDeg: b.latitudeDeg - (fp.subSatellite.latitudeDeg - b.latitudeDeg) * 0.01, longitudeDeg: b.longitudeDeg - (fp.subSatellite.longitudeDeg - b.longitudeDeg) * 0.01 };
      expect(observerFootprintVisibility(sat, ground(toward), 10).inside).toBe(true);
      expect(observerFootprintVisibility(sat, ground(away), 10).inside).toBe(false);
    }
  });

  it('is outside on the far side of the Earth', () => {
    const v = observerFootprintVisibility(sat, ground({ latitudeDeg: -40, longitudeDeg: 80, altitudeKm: 0 }), 0);
    expect(v.inside).toBe(false);
    expect(v.elevationDeg).toBeLessThan(-60);
  });
});
