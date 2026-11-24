/**
 * Physical and time constants used across the orbit module.
 * Units are in each name.
 */

/** WGS84 equatorial radius, km. */
export const WGS84_A_KM = 6378.137;
/** WGS84 flattening. */
export const WGS84_F = 1 / 298.257223563;
/** WGS84 first eccentricity squared. */
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** WGS84 polar radius, km. */
export const WGS84_B_KM = WGS84_A_KM * (1 - WGS84_F);
/** Mean Earth radius (IUGG), km. Used for display scaling, not for geodesy. */
export const EARTH_MEAN_RADIUS_KM = 6371.0088;

/**
 * Earth rotation rate, rad/s, as used by Vallado for the TEME -> PEF velocity
 * transformation (length-of-day correction ignored).
 */
export const EARTH_ROTATION_RAD_S = 7.292115146706979e-5;

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;
/** Julian date of the Unix epoch, 1970-01-01T00:00:00Z. */
export const JD_UNIX_EPOCH = 2440587.5;
/** Julian date of J2000.0, 2000-01-01T12:00:00 TT (used here with UT1 = UTC). */
export const JD_J2000 = 2451545.0;

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
export const TWO_PI = 2 * Math.PI;
