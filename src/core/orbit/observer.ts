/**
 * Observer (ground station) geometry: validation, Earth-fixed position and
 * the local East-North-Up (ENU) frame.
 *
 * ENU is the topocentric frame at the observer: east and north are tangent to
 * the WGS84 ellipsoid, up is the ellipsoid normal (geodetic vertical). For an
 * Earth-fixed offset d = r_target - r_observer:
 *
 *   e = -sin(lon) dx + cos(lon) dy
 *   n = -sin(lat) cos(lon) dx - sin(lat) sin(lon) dy + cos(lat) dz
 *   u =  cos(lat) cos(lon) dx + cos(lat) sin(lon) dy + sin(lat) dz
 *
 * At the geographic poles "north" is degenerate; the formulas still give a
 * valid orthonormal frame. Its north axis is the direction of increasing
 * latitude along the observer's meridian, continued over the pole, i.e. it
 * points toward longitude (lon + 180). East is 90 degrees clockwise from it.
 * Azimuths at a pole are therefore relative to the entered longitude.
 */
import type { Enu, Vec3 } from '../../types/orbital';
import type { ObserverLocation, ObserverValidationErrors } from '../../types/observer';
import { DEG_TO_RAD } from './constants';
import { geodeticToEcef } from './coordinate-transformations';

/** Accepted observer altitude range, meters (Dead Sea shore to high-altitude balloon). */
export const OBSERVER_ALTITUDE_MIN_M = -500;
export const OBSERVER_ALTITUDE_MAX_M = 50_000;

/** Range validation for user-entered locations. Empty object means valid. */
export function validateObserverLocation(
  loc: Pick<ObserverLocation, 'latitudeDeg' | 'longitudeDeg' | 'altitudeM'>,
): ObserverValidationErrors {
  const errors: ObserverValidationErrors = {};
  if (!Number.isFinite(loc.latitudeDeg) || loc.latitudeDeg < -90 || loc.latitudeDeg > 90) {
    errors.latitudeDeg = 'Latitude must be between -90 and 90 degrees';
  }
  if (!Number.isFinite(loc.longitudeDeg) || loc.longitudeDeg < -180 || loc.longitudeDeg > 180) {
    errors.longitudeDeg = 'Longitude must be between -180 and 180 degrees';
  }
  if (
    !Number.isFinite(loc.altitudeM) ||
    loc.altitudeM < OBSERVER_ALTITUDE_MIN_M ||
    loc.altitudeM > OBSERVER_ALTITUDE_MAX_M
  ) {
    errors.altitudeM = `Altitude must be between ${OBSERVER_ALTITUDE_MIN_M} and ${OBSERVER_ALTITUDE_MAX_M} meters`;
  }
  return errors;
}

/** Observer position in ECEF, km. Converts the altitude from meters. */
export function observerEcef(loc: ObserverLocation): Vec3 {
  return geodeticToEcef({
    latitudeDeg: loc.latitudeDeg,
    longitudeDeg: loc.longitudeDeg,
    altitudeKm: loc.altitudeM / 1000,
  });
}

/**
 * Rotates an Earth-fixed vector (an offset or a velocity, not a position)
 * into the observer's ENU axes.
 */
export function ecefVectorToEnu(v: Vec3, loc: Pick<ObserverLocation, 'latitudeDeg' | 'longitudeDeg'>): Enu {
  const lat = loc.latitudeDeg * DEG_TO_RAD;
  const lon = loc.longitudeDeg * DEG_TO_RAD;
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  return {
    eastKm: -sLon * v.x + cLon * v.y,
    northKm: -sLat * cLon * v.x - sLat * sLon * v.y + cLat * v.z,
    upKm: cLat * cLon * v.x + cLat * sLon * v.y + sLat * v.z,
  };
}

/** ENU coordinates of an ECEF target position (km) as seen from the observer. */
export function ecefToEnu(targetEcefKm: Vec3, loc: ObserverLocation): Enu {
  const o = observerEcef(loc);
  return ecefVectorToEnu(
    { x: targetEcefKm.x - o.x, y: targetEcefKm.y - o.y, z: targetEcefKm.z - o.z },
    loc,
  );
}
