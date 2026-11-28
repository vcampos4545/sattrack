/**
 * Classical orbital elements of a TLE, for display.
 *
 * These are SGP4 *mean* elements at the TLE epoch, read from the initialized
 * satellite.js SatRec. They are not osculating elements at simulation time:
 * SGP4 mean elements average out short-period J2 terms, and they do not
 * change as the simulation clock moves. Mean motion is the un-Kozai'd
 * (Brouwer) value SGP4 uses internally, so the derived period differs from
 * the raw TLE mean motion by a few hundredths of a minute.
 *
 * Derived values use WGS72 constants, which TLEs are generated against:
 * semi-major axis a = (mu / n^2)^(1/3), period = 2 pi / n,
 * perigee/apogee altitude = a (1 -/+ e) - R_earth (spherical, equatorial radius).
 */
import type { SatRec } from 'satellite.js';
import { JD_UNIX_EPOCH, MS_PER_DAY, RAD_TO_DEG, TWO_PI } from './constants';

/** WGS72 gravitational parameter, km^3/s^2. */
export const WGS72_MU_KM3_S2 = 398600.8;
/** WGS72 equatorial radius, km. */
export const WGS72_RADIUS_KM = 6378.135;

export interface OrbitalElements {
  /** Mean inclination, degrees. */
  inclinationDeg: number;
  /** Mean eccentricity, dimensionless. */
  eccentricity: number;
  /** Mean right ascension of the ascending node, degrees. */
  raanDeg: number;
  /** Mean argument of perigee, degrees. */
  argPerigeeDeg: number;
  /** Mean anomaly at epoch, degrees. */
  meanAnomalyDeg: number;
  /** Mean motion, revolutions per day. */
  meanMotionRevPerDay: number;
  /** Orbital period, minutes. */
  periodMin: number;
  /** Semi-major axis, km. */
  semiMajorAxisKm: number;
  /** Perigee altitude above the WGS72 equatorial radius, km. */
  perigeeAltKm: number;
  /** Apogee altitude above the WGS72 equatorial radius, km. */
  apogeeAltKm: number;
  /** B* drag term, 1/earth radii. */
  bstar: number;
  /** Element set epoch, UTC ms. */
  epochMs: number;
}

/** Semi-major axis (km) from mean motion in rad/s, by Kepler's third law (WGS72). */
export function semiMajorAxisFromMeanMotion(meanMotionRadS: number): number {
  return Math.cbrt(WGS72_MU_KM3_S2 / (meanMotionRadS * meanMotionRadS));
}

/** Mean elements of an initialized SatRec at its epoch. */
export function orbitalElements(satrec: SatRec): OrbitalElements {
  const noRadMin = satrec.no; // un-Kozai'd mean motion, rad/min
  const periodMin = TWO_PI / noRadMin;
  const a = semiMajorAxisFromMeanMotion(noRadMin / 60);
  const e = satrec.ecco;
  return {
    inclinationDeg: satrec.inclo * RAD_TO_DEG,
    eccentricity: e,
    raanDeg: satrec.nodeo * RAD_TO_DEG,
    argPerigeeDeg: satrec.argpo * RAD_TO_DEG,
    meanAnomalyDeg: satrec.mo * RAD_TO_DEG,
    meanMotionRevPerDay: (noRadMin * 1440) / TWO_PI,
    periodMin,
    semiMajorAxisKm: a,
    perigeeAltKm: a * (1 - e) - WGS72_RADIUS_KM,
    apogeeAltKm: a * (1 + e) - WGS72_RADIUS_KM,
    bstar: satrec.bstar,
    epochMs: (satrec.jdsatepoch - JD_UNIX_EPOCH) * MS_PER_DAY,
  };
}
