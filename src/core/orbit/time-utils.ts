/**
 * Time conversions for the orbit module.
 *
 * Conventions:
 * - Every instant is a UTC timestamp in milliseconds since the Unix epoch
 *   (`number`, the same value `Date.getTime()` returns). Never local time.
 * - Orbit code never reads the system clock. Callers pass the simulation time
 *   from `stores/time-store.ts` (`getSimTimeMs()`).
 * - UT1 is approximated by UTC. |UT1 - UTC| < 0.9 s by definition, which moves
 *   Earth-fixed positions by at most ~0.4 km at the equator (Earth surface
 *   speed ~0.465 km/s). Leap seconds are irrelevant at that level because
 *   JavaScript timestamps are UTC without leap seconds.
 */
import {
  DEG_TO_RAD,
  JD_J2000,
  JD_UNIX_EPOCH,
  MS_PER_DAY,
  MS_PER_MINUTE,
  TWO_PI,
} from './constants';

/** UTC ms -> Julian date (UTC used as UT1). */
export function msToJulianDate(ms: number): number {
  return ms / MS_PER_DAY + JD_UNIX_EPOCH;
}

/** Julian date -> UTC ms. */
export function julianDateToMs(jd: number): number {
  return (jd - JD_UNIX_EPOCH) * MS_PER_DAY;
}

/** Minutes from `fromMs` to `toMs` (negative when `toMs` is earlier). */
export function minutesBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / MS_PER_MINUTE;
}

/**
 * Greenwich Mean Sidereal Time, IAU 1982 model (Vallado, "Fundamentals of
 * Astrodynamics", eq. 3-47). This is the angle SGP4's TEME frame is rotated by
 * to reach the pseudo Earth-fixed frame.
 *
 * @param ms UTC ms (treated as UT1)
 * @returns GMST in radians, [0, 2pi)
 */
export function gmstRad(ms: number): number {
  const tUt1 = (msToJulianDate(ms) - JD_J2000) / 36525;
  // Seconds of sidereal time.
  const seconds =
    -6.2e-6 * tUt1 * tUt1 * tUt1 +
    0.093104 * tUt1 * tUt1 +
    (876600 * 3600 + 8640184.812866) * tUt1 +
    67310.54841;
  // 1 second of time = 1/240 degree.
  let theta = ((seconds * DEG_TO_RAD) / 240) % TWO_PI;
  if (theta < 0) theta += TWO_PI;
  return theta;
}

/**
 * Converts a TLE epoch (two-digit year + fractional day of year, day 1.0 =
 * Jan 1 00:00 UTC) to UTC ms. Two-digit years 57-99 are 1957-1999 and 00-56
 * are 2000-2056, the standard TLE convention.
 */
export function tleEpochToMs(twoDigitYear: number, dayOfYear: number): number {
  const year = twoDigitYear < 57 ? 2000 + twoDigitYear : 1900 + twoDigitYear;
  return Date.UTC(year, 0, 1) + (dayOfYear - 1) * MS_PER_DAY;
}

/** Element-set age at `atMs`, in days. Negative when the epoch is in the future. */
export function epochAgeDays(epochMs: number, atMs: number): number {
  return (atMs - epochMs) / MS_PER_DAY;
}

/**
 * SGP4 accuracy degrades roughly linearly with |t - epoch| (on the order of
 * 1-3 km/day for LEO). Thresholds below are for UI warnings, not hard limits.
 */
export const EPOCH_AGING_DAYS = 3;
export const EPOCH_STALE_DAYS = 14;

/**
 * Buckets the distance between the evaluation time and the element epoch.
 * Uses |age| so that propagating far into the future is flagged as well.
 */
export function classifyEpochAge(epochMs: number, atMs: number): 'fresh' | 'aging' | 'stale' {
  const days = Math.abs(epochAgeDays(epochMs, atMs));
  if (days < EPOCH_AGING_DAYS) return 'fresh';
  if (days < EPOCH_STALE_DAYS) return 'aging';
  return 'stale';
}
