/**
 * Observer-relative look angles: azimuth, elevation, range and range rate.
 *
 *   azimuth   = atan2(E, N), normalized to [0, 360), clockwise from true north
 *   elevation = atan2(U, sqrt(E^2 + N^2))
 *   range     = |r_sat - r_obs|
 *   rangeRate = (r_sat - r_obs) . v_sat / range
 *
 * All vectors are Earth-fixed. The observer is at rest in that frame, so the
 * relative velocity is the satellite's true Earth-fixed velocity (from
 * `temeToEcef`, which removes the Earth's rotation). Elevation is geometric:
 * no atmospheric refraction is applied (refraction lifts objects near the
 * horizon by ~0.5 deg, which matters only for optical work).
 */
import type { EcefState, Enu, LookAngles } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';
import { RAD_TO_DEG } from './constants';
import { normalizeDegrees360, vecDot, vecMagnitude, vecSub } from './coordinate-transformations';
import { ecefVectorToEnu, observerEcef } from './observer';

/**
 * Below this ratio of horizontal to total distance (~2e-8 deg off zenith or
 * nadir) azimuth is numerically meaningless and is reported as 0.
 */
const ZENITH_AZIMUTH_EPSILON = 1e-10;

/** Azimuth/elevation (degrees) of an ENU vector. Azimuth is 0 at the zenith/nadir. */
export function enuToAzEl(enu: Enu): { azimuthDeg: number; elevationDeg: number } {
  const horizontal = Math.hypot(enu.eastKm, enu.northKm);
  const atZenith = horizontal <= ZENITH_AZIMUTH_EPSILON * Math.abs(enu.upKm);
  const azimuthDeg = atZenith ? 0 : normalizeDegrees360(Math.atan2(enu.eastKm, enu.northKm) * RAD_TO_DEG);
  const elevationDeg = Math.atan2(enu.upKm, horizontal) * RAD_TO_DEG;
  return { azimuthDeg, elevationDeg };
}

/** Look angles from an observer to a satellite's Earth-fixed state. */
export function computeLookAngles(sat: EcefState, observer: ObserverLocation): LookAngles {
  const rel = vecSub(sat.positionKm, observerEcef(observer));
  const rangeKm = vecMagnitude(rel);
  const { azimuthDeg, elevationDeg } = enuToAzEl(ecefVectorToEnu(rel, observer));
  const rangeRateKmS = rangeKm === 0 ? 0 : vecDot(rel, sat.velocityKmS) / rangeKm;
  return { azimuthDeg, elevationDeg, rangeKm, rangeRateKmS };
}
