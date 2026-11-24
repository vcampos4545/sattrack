/**
 * Pass prediction types shared by the passes table and the sky plot.
 * Times are UTC ms since the Unix epoch; display code converts to local time.
 */

/** One sample of a pass trajectory in the observer's sky. */
export interface PassTrackSample {
  timeMs: number;
  /** Degrees clockwise from true north, [0, 360). */
  azimuthDeg: number;
  /** Degrees above the horizon. Samples at AOS/LOS sit at the elevation mask. */
  elevationDeg: number;
  rangeKm: number;
  /** Positive = receding, km/s. */
  rangeRateKmS: number;
}

/** A predicted pass of one satellite over one observer. */
export interface Pass {
  /** Stable id, `${noradId}-${aosMs}`, used as `selectedPassId`. */
  id: string;
  noradId: number;
  /** Elevation mask the pass was computed with, degrees. */
  elevationMaskDeg: number;
  /** Acquisition of signal: rising through the mask. */
  aosMs: number;
  aosAzimuthDeg: number;
  /** Loss of signal: setting through the mask. */
  losMs: number;
  losAzimuthDeg: number;
  /** Time of maximum elevation. */
  maxElevationMs: number;
  maxElevationDeg: number;
  maxElevationAzimuthDeg: number;
  /** losMs - aosMs, seconds. */
  durationS: number;
  /**
   * True when the search started with the satellite already above the mask,
   * so `aosMs` is the search start rather than a refined rise time.
   */
  inProgressAtSearchStart: boolean;
  /** Sampled sky trajectory from AOS to LOS, in time order, for the sky plot. */
  track: PassTrackSample[];
}
