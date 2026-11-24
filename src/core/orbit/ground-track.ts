/**
 * Ground track: the path of the sub-satellite point over the Earth's surface.
 *
 * The sub-satellite point at time t is the WGS84 geodetic latitude/longitude
 * of the satellite's Earth-fixed position (TEME rotated by GMST(t), see
 * coordinate-transformations.ts). Rotating by GMST at each sample's own time
 * is what accounts for the Earth turning underneath the orbit: a low prograde
 * orbit's track drifts west by roughly (Earth rotation rate x period) per
 * revolution, about 23 degrees for the ISS.
 *
 * This is different from the coverage footprint (footprint.ts): the track is
 * a line of points directly below the satellite over time, the footprint is
 * the region of the surface that can see the satellite at one instant.
 *
 * Units: UTC ms for time, degrees for latitude/longitude, km for altitude.
 * Longitudes are wrapped to (-180, 180]; `splitAtAntimeridian` turns a track
 * into segments that do not jump across the date line, for 2D drawing or any
 * consumer that interpolates in longitude.
 */
import type { SatRec } from 'satellite.js';
import type { SatelliteState } from '../../types/orbital';
import { DEG_TO_RAD, MS_PER_MINUTE, RAD_TO_DEG } from './constants';
import { normalizeDegrees360 } from './coordinate-transformations';
import { ecefVectorToEnu } from './observer';
import { sampleTrajectory } from './satellite-propagator';

/** One sub-satellite point. */
export interface GroundTrackPoint {
  /** UTC ms (simulation time). */
  timeMs: number;
  /** Geodetic latitude, degrees. */
  latitudeDeg: number;
  /** Longitude, degrees, (-180, 180]. */
  longitudeDeg: number;
  /** Satellite height above the WGS84 ellipsoid at this time, km. */
  altitudeKm: number;
}

/**
 * Sub-satellite points between two instants (inclusive), from SGP4 states.
 * Samples where SGP4 fails (e.g. after decay) are skipped, so consumers must
 * not assume uniform spacing.
 */
export function computeGroundTrack(satrec: SatRec, startMs: number, endMs: number, stepMs: number): GroundTrackPoint[] {
  return sampleTrajectory(satrec, startMs, endMs, stepMs).map((s) => ({
    timeMs: s.timeMs,
    latitudeDeg: s.geodetic.latitudeDeg,
    longitudeDeg: s.geodetic.longitudeDeg,
    altitudeKm: s.geodetic.altitudeKm,
  }));
}

/** Time window and sample spacing for a ground track around "now". */
export interface GroundTrackWindow {
  /** How far back the historical track reaches, ms. */
  pastMs: number;
  /** How far ahead the predicted track reaches, ms. */
  futureMs: number;
  /** Sample spacing, ms. */
  stepMs: number;
}

/** Longest window drawn on either side of now. Keeps GEO/HEO tracks bounded. */
export const GROUND_TRACK_MAX_SPAN_MS = 24 * 3_600_000;
/** Samples per orbital period before clamping the step. */
const SAMPLES_PER_PERIOD = 240;
const MIN_STEP_MS = 10_000;
const MAX_STEP_MS = 5 * MS_PER_MINUTE;

/**
 * Chooses a window and step from the orbital period. About 240 samples per
 * revolution keeps chords short (the ISS moves ~1.5 degrees per 23 s step,
 * so the straight segment between samples sags ~1 km below the true arc).
 * The step is clamped to [10 s, 5 min] and each side to 24 h, so a
 * geostationary object gets a one-day figure-eight, not thousands of samples.
 */
export function groundTrackWindow(periodMin: number, pastPeriods: number, futurePeriods: number): GroundTrackWindow {
  const periodMs = (Number.isFinite(periodMin) && periodMin > 0 ? periodMin : 90) * MS_PER_MINUTE;
  const stepMs = Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, periodMs / SAMPLES_PER_PERIOD));
  return {
    pastMs: Math.min(GROUND_TRACK_MAX_SPAN_MS, Math.max(0, pastPeriods) * periodMs),
    futureMs: Math.min(GROUND_TRACK_MAX_SPAN_MS, Math.max(0, futurePeriods) * periodMs),
    stepMs,
  };
}

/**
 * Index of the first point strictly after `nowMs` (binary search; points must
 * be in time order). Points before it are the historical track, points from it
 * on are the predicted track. Returns `points.length` when all are in the past.
 */
export function splitIndex(points: readonly GroundTrackPoint[], nowMs: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]!.timeMs <= nowMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Splits a track into runs that never jump across the +/-180 meridian. When
 * consecutive points are more than 180 degrees apart in longitude the shorter
 * way round crosses the date line; a boundary point is interpolated (linearly
 * in time, latitude and unwrapped longitude) and placed at +180 on one side
 * and -180 on the other, so each segment can be drawn as an open polyline.
 *
 * A straight 180-degree difference (an exact pole crossing) is ambiguous and
 * treated as no crossing.
 */
export function splitAtAntimeridian(points: readonly GroundTrackPoint[]): GroundTrackPoint[][] {
  const segments: GroundTrackPoint[][] = [];
  let current: GroundTrackPoint[] = [];
  let prev: GroundTrackPoint | undefined;
  for (const p of points) {
    if (prev) {
      const dLon = p.longitudeDeg - prev.longitudeDeg;
      if (Math.abs(dLon) > 180) {
        // Eastward over the line when dLon < -180 (e.g. 179 -> -179).
        const edge = dLon < 0 ? 180 : -180;
        const unwrappedNext = p.longitudeDeg + (dLon < 0 ? 360 : -360);
        const f = (edge - prev.longitudeDeg) / (unwrappedNext - prev.longitudeDeg);
        const lerp = (a: number, b: number) => a + (b - a) * f;
        const cross = {
          timeMs: lerp(prev.timeMs, p.timeMs),
          latitudeDeg: lerp(prev.latitudeDeg, p.latitudeDeg),
          altitudeKm: lerp(prev.altitudeKm, p.altitudeKm),
        };
        current.push({ ...cross, longitudeDeg: edge });
        segments.push(current);
        current = [{ ...cross, longitudeDeg: -edge }];
      }
    }
    current.push(p);
    prev = p;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/**
 * Initial great-circle bearing from `a` to `b`, degrees clockwise from north,
 * [0, 360). Spherical approximation (bearing error versus the WGS84 geodesic
 * is a fraction of a degree), used for the track's direction of travel.
 */
export function initialBearingDeg(
  a: Pick<GroundTrackPoint, 'latitudeDeg' | 'longitudeDeg'>,
  b: Pick<GroundTrackPoint, 'latitudeDeg' | 'longitudeDeg'>,
): number {
  const lat1 = a.latitudeDeg * DEG_TO_RAD;
  const lat2 = b.latitudeDeg * DEG_TO_RAD;
  const dLon = (b.longitudeDeg - a.longitudeDeg) * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeDegrees360(Math.atan2(y, x) * RAD_TO_DEG);
}

/**
 * Direction the sub-satellite point is moving, degrees clockwise from north,
 * [0, 360). It is the azimuth of the satellite's Earth-relative (ECEF)
 * velocity in the local horizontal plane at the sub-satellite point, so it
 * includes the Earth's rotation, unlike the inertial flight direction.
 */
export function groundTrackHeadingDeg(state: Pick<SatelliteState, 'ecef' | 'geodetic'>): number {
  const enu = ecefVectorToEnu(state.ecef.velocityKmS, state.geodetic);
  return normalizeDegrees360(Math.atan2(enu.eastKm, enu.northKm) * RAD_TO_DEG);
}
