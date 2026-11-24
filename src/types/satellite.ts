/**
 * Satellite catalog types. Everything here is plain serializable data. SGP4
 * state (satellite.js `SatRec`) is derived from `TleRecord` on demand and
 * cached by `satrecFor` in `core/orbit/sgp4.ts`, never stored in React state.
 */

/**
 * Display category. When an object belongs to several CelesTrak groups, the
 * category is chosen by `CATEGORY_PRIORITY` (first match wins).
 */
export type SatelliteCategory =
  | 'iss'
  | 'stations'
  | 'gnss'
  | 'weather'
  | 'starlink'
  | 'amateur'
  | 'science'
  | 'active'
  | 'other';

export const CATEGORY_PRIORITY: readonly SatelliteCategory[] = [
  'iss',
  'stations',
  'gnss',
  'weather',
  'starlink',
  'amateur',
  'science',
  'active',
  'other',
];

export const CATEGORY_LABELS: Record<SatelliteCategory, string> = {
  iss: 'ISS',
  stations: 'Space stations',
  gnss: 'GPS / GNSS',
  weather: 'Weather',
  starlink: 'Starlink',
  amateur: 'Amateur radio',
  science: 'Science',
  active: 'Active',
  other: 'Other',
};

/** Identifier of a predefined CelesTrak group (see `services/celestrak.ts`). */
export type CatalogGroupId =
  | 'stations'
  | 'weather'
  | 'gps-ops'
  | 'amateur'
  | 'science'
  | 'starlink'
  | 'active';

/** One validated two-line element set, as parsed by `core/orbit/tle-parser.ts`. */
export interface TleRecord {
  /** Object name from the title line, trimmed. `NORAD <id>` when absent. */
  name: string;
  line1: string;
  line2: string;
  /** NORAD catalog number (Alpha-5 decoded). */
  noradId: number;
  /** International designator as written in the TLE (e.g. `98067A`), may be empty. */
  intlDesignator: string;
  /** Element set epoch, UTC ms since the Unix epoch. */
  epochMs: number;
  /** Mean inclination, degrees. */
  inclinationDeg: number;
  /** Mean right ascension of the ascending node, degrees. */
  raanDeg: number;
  /** Mean eccentricity, dimensionless. */
  eccentricity: number;
  /** Mean argument of perigee, degrees. */
  argPerigeeDeg: number;
  /** Mean anomaly, degrees. */
  meanAnomalyDeg: number;
  /** Mean motion, revolutions per day. */
  meanMotionRevPerDay: number;
  /** Orbital period derived from mean motion, minutes. */
  periodMin: number;
  /** B* drag term, 1/earth radii. */
  bstar: number;
}

/** A catalog entry: a TLE plus catalog metadata. */
export interface SatelliteRecord {
  noradId: number;
  name: string;
  category: SatelliteCategory;
  /** CelesTrak groups this object was loaded from. Empty when added by NORAD ID only. */
  groups: CatalogGroupId[];
  tle: TleRecord;
}

/** Freshness bucket of an element set relative to the evaluation time. */
export type EpochFreshness = 'fresh' | 'aging' | 'stale';

/** Where a group's data came from on the last load. */
export type CatalogSource = 'network' | 'cache' | 'none';

/** Per-group status after a catalog load. */
export interface CatalogGroupStatus {
  groupId: CatalogGroupId;
  source: CatalogSource;
  /** Wall-clock UTC ms when the data was downloaded from CelesTrak, or null if never. */
  fetchedAtMs: number | null;
  recordCount: number;
  /** Count of malformed records that were dropped while parsing. */
  rejectedCount: number;
  /** Network or parse error from this load, if any. Cached data may still be in use. */
  error: string | null;
}
