/**
 * Coordinate transformations: TEME -> Earth-fixed -> geodetic.
 *
 * Frames
 * ------
 * TEME  True Equator, Mean Equinox. SGP4's output frame. Quasi-inertial:
 *       z along the true (date) rotation axis, x toward the mean equinox.
 * ECEF  Earth-Centered Earth-Fixed. x through (lat 0, lon 0), z through the
 *       north pole, y completes a right-handed set (through lon 90 E).
 *       Implemented as PEF (Pseudo Earth Fixed): TEME rotated about z by
 *       GMST. Polar motion (the PEF -> ITRF step, x_p, y_p < ~0.5 arcsec) is
 *       NOT applied: it moves points on the Earth's surface by up to ~15 m,
 *       far below SGP4's own error (~1 km at epoch, growing a few km/day).
 *       UT1 is approximated by UTC (see time-utils.ts), which adds up to
 *       ~0.4 km along-track at the equator. Total frame error: < 0.5 km.
 *
 * Rotation (Vallado, "Revisiting Spacetrack Report #3", Appendix C):
 *   r_ecef = R3(gmst) * r_teme
 *   v_ecef = R3(gmst) * v_teme - omega_earth x r_ecef
 * where R3(t) rotates the axes by +t about z:
 *   [ cos t   sin t  0 ]
 *   [-sin t   cos t  0 ]
 *   [   0       0    1 ]
 *
 * Geodetic: WGS84 ellipsoid, latitude geodetic (normal to the ellipsoid).
 * Units: km, km/s, radians internally; degrees only at the Geodetic boundary.
 */
import type { EcefState, Geodetic, TemeState, Vec3 } from '../../types/orbital';
import {
  DEG_TO_RAD,
  EARTH_ROTATION_RAD_S,
  RAD_TO_DEG,
  WGS84_A_KM,
  WGS84_E2,
} from './constants';

/** Wraps a longitude in degrees to (-180, 180]. */
export function wrapLongitudeDeg(lonDeg: number): number {
  let lon = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  if (lon === -180) lon = 180;
  return lon;
}

/** Normalizes an angle in degrees to [0, 360). */
export function normalizeDegrees360(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  return d === 360 ? 0 : d;
}

/** Rotates a TEME position into ECEF (PEF) using GMST in radians. */
export function temePositionToEcef(r: Vec3, gmstRad: number): Vec3 {
  const c = Math.cos(gmstRad);
  const s = Math.sin(gmstRad);
  return { x: c * r.x + s * r.y, y: -s * r.x + c * r.y, z: r.z };
}

/** Inverse of `temePositionToEcef`. */
export function ecefPositionToTeme(r: Vec3, gmstRad: number): Vec3 {
  const c = Math.cos(gmstRad);
  const s = Math.sin(gmstRad);
  return { x: c * r.x - s * r.y, y: s * r.x + c * r.y, z: r.z };
}

/**
 * Converts a TEME state to an Earth-fixed state. The velocity is the true
 * Earth-relative velocity: after rotating the axes, the velocity of the
 * rotating frame at the position (omega x r) is subtracted.
 */
export function temeToEcef(state: TemeState, gmstRad: number): EcefState {
  const positionKm = temePositionToEcef(state.positionKm, gmstRad);
  const vRot = temePositionToEcef(state.velocityKmS, gmstRad);
  // omega x r with omega = (0, 0, w): (-w*y, w*x, 0)
  const w = EARTH_ROTATION_RAD_S;
  return {
    positionKm,
    velocityKmS: {
      x: vRot.x + w * positionKm.y,
      y: vRot.y - w * positionKm.x,
      z: vRot.z,
    },
  };
}

/** WGS84 geodetic (degrees, km) -> ECEF position (km). */
export function geodeticToEcef(g: Geodetic): Vec3 {
  const lat = g.latitudeDeg * DEG_TO_RAD;
  const lon = g.longitudeDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  // Prime vertical radius of curvature.
  const n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (n + g.altitudeKm) * cosLat * Math.cos(lon),
    y: (n + g.altitudeKm) * cosLat * Math.sin(lon),
    z: (n * (1 - WGS84_E2) + g.altitudeKm) * sinLat,
  };
}

/**
 * ECEF position (km) -> WGS84 geodetic (degrees, km).
 *
 * Fixed-point iteration on latitude using
 *   tan(lat) = (z + e^2 N sin(lat)) / p,   p = sqrt(x^2 + y^2)
 * and the height form
 *   h = p cos(lat) + z sin(lat) - a^2 / N
 * which, unlike h = p / cos(lat) - N, stays well conditioned at the poles.
 * Converges to < 1e-12 rad in a handful of iterations for any point outside
 * the Earth's core.
 */
export function ecefToGeodetic(r: Vec3): Geodetic {
  const p = Math.hypot(r.x, r.y);
  const lon = Math.atan2(r.y, r.x);
  let lat = Math.atan2(r.z, p * (1 - WGS84_E2));
  let n = WGS84_A_KM;
  for (let i = 0; i < 10; i++) {
    const sinLat = Math.sin(lat);
    n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const next = Math.atan2(r.z + WGS84_E2 * n * sinLat, p);
    const done = Math.abs(next - lat) < 1e-12;
    lat = next;
    if (done) break;
  }
  const sinLat = Math.sin(lat);
  n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const altitudeKm = p * Math.cos(lat) + r.z * sinLat - (WGS84_A_KM * WGS84_A_KM) / n;
  return {
    latitudeDeg: lat * RAD_TO_DEG,
    longitudeDeg: wrapLongitudeDeg(lon * RAD_TO_DEG),
    altitudeKm,
  };
}

export function vecMagnitude(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vecDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
