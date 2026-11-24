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

/**
 * Text form used by `<input type="datetime-local">`: `YYYY-MM-DDTHH:MM[:SS]`.
 * `zone` says how to read the wall-clock fields: `'utc'` treats them as UTC,
 * `'local'` as the runtime's local time zone (DST handled by `Date`).
 * Internally everything stays UTC ms; this is only the UI boundary.
 */
export type DateTimeZone = 'utc' | 'local';

const DATETIME_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/**
 * Parses a datetime-local string into UTC ms. Returns `null` for malformed
 * text or impossible calendar values (Feb 30, 25:00) instead of letting
 * `Date` silently roll them over.
 */
export function parseDateTimeInput(text: string, zone: DateTimeZone): number | null {
  const m = DATETIME_INPUT_RE.exec(text.trim());
  if (!m) return null;
  const num = (i: number) => (m[i] === undefined ? 0 : Number(m[i]));
  const [y, mo, d, h, mi, s] = [num(1), num(2), num(3), num(4), num(5), num(6)];
  const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const date = zone === 'utc' ? new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms)) : new Date(y, mo - 1, d, h, mi, s, ms);
  // Years 0-99 are mapped to 1900-1999 by both constructors; set explicitly.
  if (zone === 'utc') date.setUTCFullYear(y, mo - 1, d);
  else date.setFullYear(y, mo - 1, d);
  // Reject roll-over (e.g. Feb 30 -> Mar 2). Local times skipped by a DST
  // gap shift the hour, which is accepted: Date picks the next valid instant.
  const dayOk =
    zone === 'utc'
      ? date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
      : date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
  return dayOk ? date.getTime() : null;
}

/** UTC ms -> `YYYY-MM-DDTHH:MM:SS` in the given zone, for datetime-local inputs. */
export function formatDateTimeInput(ms: number, zone: DateTimeZone): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const utc = zone === 'utc';
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const mo = utc ? d.getUTCMonth() : d.getMonth();
  const day = utc ? d.getUTCDate() : d.getDate();
  const h = utc ? d.getUTCHours() : d.getHours();
  const mi = utc ? d.getUTCMinutes() : d.getMinutes();
  const s = utc ? d.getUTCSeconds() : d.getSeconds();
  return `${p(y, 4)}-${p(mo + 1)}-${p(day)}T${p(h)}:${p(mi)}:${p(s)}`;
}

