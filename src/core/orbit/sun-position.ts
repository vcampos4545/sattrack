/**
 * Low-precision Sun direction, used for the day/night terminator.
 *
 * Algorithm: the Astronomical Almanac's low-precision solar coordinates, as
 * given by Vallado ("Fundamentals of Astrodynamics", Algorithm 29). Stated
 * accuracy is about 0.01 degrees from 1950 to 2050.
 *
 *   T       = Julian centuries of UT1 since J2000 (UT1 approximated by UTC)
 *   lambdaM = 280.460 + 36000.771 T                      mean longitude, deg
 *   M       = 357.5291092 + 35999.05034 T                mean anomaly, deg
 *   lambda  = lambdaM + 1.914666471 sin M + 0.019994643 sin 2M   ecliptic longitude
 *   eps     = 23.439291 - 0.0130042 T                    obliquity of the ecliptic
 *   r_hat   = [cos lambda, cos eps sin lambda, sin eps sin lambda]
 *
 * Frame: the result is in the Mean-of-Date equatorial frame. We use it as if
 * it were TEME. The two differ by the equation of the equinoxes (nutation in
 * longitude times cos eps, at most about 1.2 arcminutes) about the z axis and
 * by nutation in obliquity (about 10 arcseconds). That moves the terminator by
 * at most ~2 km on the ground, invisible at globe scale and far below the
 * width of the twilight band.
 *
 * Only the direction is returned. The terminator shading needs nothing else.
 */
import type { Vec3 } from '../../types/orbital';
import { DEG_TO_RAD, JD_J2000 } from './constants';
import { msToJulianDate } from './time-utils';

/** Unit vector from the Earth's center toward the Sun, TEME (see frame note above). */
export function sunDirectionTeme(timeMs: number): Vec3 {
  const t = (msToJulianDate(timeMs) - JD_J2000) / 36525;
  const meanLongitudeDeg = 280.46 + 36000.771 * t;
  const meanAnomalyRad = (357.5291092 + 35999.05034 * t) * DEG_TO_RAD;
  const eclipticLongitudeRad =
    (meanLongitudeDeg + 1.914666471 * Math.sin(meanAnomalyRad) + 0.019994643 * Math.sin(2 * meanAnomalyRad)) *
    DEG_TO_RAD;
  const obliquityRad = (23.439291 - 0.0130042 * t) * DEG_TO_RAD;
  const sinL = Math.sin(eclipticLongitudeRad);
  return {
    x: Math.cos(eclipticLongitudeRad),
    y: Math.cos(obliquityRad) * sinL,
    z: Math.sin(obliquityRad) * sinL,
  };
}
