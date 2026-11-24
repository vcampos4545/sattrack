/**
 * Coverage footprint: the region of the Earth's surface from which the
 * satellite is at or above a minimum elevation angle at one instant.
 *
 * Geometry (spherical Earth of radius R, satellite at geocentric distance r,
 * minimum elevation e). In the triangle Earth center / ground point /
 * satellite, the angle at the satellite is the nadir angle eta and the angle
 * at the center is the Earth central angle lambda:
 *
 *   sin(eta) = (R / r) cos(e)
 *   lambda   = 90 deg - e - eta
 *
 * The footprint edge is every surface point at central angle lambda from the
 * sub-satellite point; its ground radius is lambda * R. With e = 0 this is the
 * geometric horizon (lambda = acos(R / r)): about 20 deg for the ISS and
 * 81 deg for a geostationary satellite.
 *
 * The boundary returned by `computeFootprint` is not a drawn circle of that
 * radius. The spherical lambda only brackets a root search: along each
 * azimuth from the sub-satellite point, the distance is bisected until the
 * satellite's elevation, computed on the WGS84 ellipsoid against the local
 * geodetic vertical (the same definition the look angles and pass predictions
 * use), equals e. Every boundary point therefore lies on the true elevation
 * contour, which is slightly non-circular because the Earth is oblate.
 *
 * Ground points are on the ellipsoid (height 0). Elevation is geometric (no
 * refraction). Units: km, degrees at the API, radians internally.
 */
import type { Geodetic, Vec3 } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';
import { DEG_TO_RAD, EARTH_MEAN_RADIUS_KM, RAD_TO_DEG, WGS84_A_KM, WGS84_B_KM } from './constants';
import { ecefToGeodetic, geodeticToEcef, vecMagnitude, wrapLongitudeDeg } from './coordinate-transformations';
import { computeLookAngles } from './sky-coordinates';

/** Footprint of one satellite position. */
export interface Footprint {
  /** Minimum elevation the boundary was computed for, degrees. */
  minElevationDeg: number;
  /** Sub-satellite point (geodetic, height of the satellite above the ellipsoid). */
  subSatellite: Geodetic;
  /** Boundary points on the ellipsoid surface, ordered clockwise from north as seen from above. */
  boundary: Geodetic[];
  /** Mean Earth central angle from the sub-satellite point to the boundary, degrees. */
  centralAngleDeg: number;
  /** Mean ground (great-circle) radius of the footprint, km, on the IUGG mean sphere. */
  groundRadiusKm: number;
}

/**
 * Earth central angle (radians) from the sub-satellite point to the edge of
 * coverage on a sphere of radius `earthRadiusKm`. Returns 0 when the
 * satellite is at or below the surface.
 */
export function footprintCentralAngleRad(satRadiusKm: number, earthRadiusKm: number, minElevationDeg: number): number {
  if (!(satRadiusKm > earthRadiusKm)) return 0;
  const e = minElevationDeg * DEG_TO_RAD;
  const eta = Math.asin((earthRadiusKm / satRadiusKm) * Math.cos(e));
  return Math.max(0, Math.PI / 2 - e - eta);
}

/**
 * Point at angular distance `distRad` from (latRad, lonRad) along initial
 * bearing `azRad` on a unit sphere. Used only to parametrize the search path;
 * the root search makes the result exact on the ellipsoid.
 */
function destination(latRad: number, lonRad: number, azRad: number, distRad: number): { lat: number; lon: number } {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  if (cosLat < 1e-12) {
    // At a pole every bearing is degenerate in the formula below. Use the
    // observer.ts convention: "north" runs along the start meridian continued
    // over the pole, and azimuth is clockwise from it seen from above.
    return sinLat > 0
      ? { lat: Math.PI / 2 - distRad, lon: lonRad + Math.PI - azRad }
      : { lat: -Math.PI / 2 + distRad, lon: lonRad + azRad };
  }
  const sinD = Math.sin(distRad);
  const cosD = Math.cos(distRad);
  const lat = Math.asin(Math.max(-1, Math.min(1, sinLat * cosD + cosLat * sinD * Math.cos(azRad))));
  const lon = lonRad + Math.atan2(Math.sin(azRad) * sinD * cosLat, cosD - sinLat * Math.sin(lat));
  return { lat, lon };
}

/**
 * Sine of the satellite's elevation seen from a point on the ellipsoid
 * surface, against the geodetic vertical. Same geometry as
 * `computeLookAngles` without building an observer object per evaluation.
 */
function sinElevationFromSurface(sat: Vec3, latRad: number, lonRad: number): number {
  const ground = geodeticToEcef({ latitudeDeg: latRad * RAD_TO_DEG, longitudeDeg: lonRad * RAD_TO_DEG, altitudeKm: 0 });
  const dx = sat.x - ground.x;
  const dy = sat.y - ground.y;
  const dz = sat.z - ground.z;
  const range = Math.hypot(dx, dy, dz);
  if (range === 0) return 1;
  const cLat = Math.cos(latRad);
  const up = cLat * Math.cos(lonRad) * dx + cLat * Math.sin(lonRad) * dy + Math.sin(latRad) * dz;
  return up / range;
}

const BISECTION_ITERATIONS = 48;

/**
 * Coverage footprint for a satellite at Earth-fixed position `satEcefKm`.
 * `pointCount` boundary points are spaced evenly in azimuth around the
 * sub-satellite point. Returns null when the satellite is not above the
 * surface or the inputs are not finite.
 */
export function computeFootprint(satEcefKm: Vec3, minElevationDeg: number, pointCount = 128): Footprint | null {
  const r = vecMagnitude(satEcefKm);
  if (!Number.isFinite(r) || !Number.isFinite(minElevationDeg)) return null;
  const sub = ecefToGeodetic(satEcefKm);
  if (!(sub.altitudeKm > 0)) return null;

  const e = Math.max(0, Math.min(89.999, minElevationDeg));
  const sinE = Math.sin(e * DEG_TO_RAD);
  const lat0 = sub.latitudeDeg * DEG_TO_RAD;
  const lon0 = sub.longitudeDeg * DEG_TO_RAD;

  // The smallest Earth radius gives the widest spherical footprint, so it
  // brackets the ellipsoid root from above; the margin covers the geodetic
  // vs geocentric difference. Expanded below if it ever falls short.
  const initialHi = Math.min(Math.PI, footprintCentralAngleRad(r, WGS84_B_KM, e) * 1.05 + 0.01);

  const boundary: Geodetic[] = [];
  let angleSum = 0;
  for (let i = 0; i < pointCount; i++) {
    const az = (i / pointCount) * 2 * Math.PI;
    const f = (d: number) => {
      const p = destination(lat0, lon0, az, d);
      return sinElevationFromSurface(satEcefKm, p.lat, p.lon) - sinE;
    };
    let lo = 0;
    let hi = initialHi;
    while (f(hi) > 0 && hi < Math.PI) hi = Math.min(Math.PI, hi * 1.5);
    for (let k = 0; k < BISECTION_ITERATIONS; k++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid) > 0) lo = mid;
      else hi = mid;
    }
    const d = 0.5 * (lo + hi);
    const p = destination(lat0, lon0, az, d);
    boundary.push({ latitudeDeg: p.lat * RAD_TO_DEG, longitudeDeg: wrapLongitudeDeg(p.lon * RAD_TO_DEG), altitudeKm: 0 });
    angleSum += d;
  }

  const meanAngle = pointCount > 0 ? angleSum / pointCount : footprintCentralAngleRad(r, WGS84_A_KM, e);
  return {
    minElevationDeg: e,
    subSatellite: sub,
    boundary,
    centralAngleDeg: meanAngle * RAD_TO_DEG,
    groundRadiusKm: meanAngle * EARTH_MEAN_RADIUS_KM,
  };
}

/**
 * Whether an observer is inside the footprint, i.e. sees the satellite at or
 * above `minElevationDeg`. Uses the observer's real altitude and the same
 * look-angle math as the sky plot and pass prediction, so the three agree.
 */
export function observerFootprintVisibility(
  satEcefKm: Vec3,
  observer: ObserverLocation,
  minElevationDeg: number,
): { inside: boolean; elevationDeg: number } {
  const { elevationDeg } = computeLookAngles({ positionKm: satEcefKm, velocityKmS: { x: 0, y: 0, z: 0 } }, observer);
  return { inside: elevationDeg >= minElevationDeg, elevationDeg };
}
