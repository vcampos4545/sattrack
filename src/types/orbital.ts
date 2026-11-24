/**
 * Shared orbital-mechanics types.
 *
 * Units are part of every name or doc comment on purpose. Unless a field says
 * otherwise: distances are kilometers, velocities are km/s, angles exposed to
 * the UI are degrees, and times are UTC milliseconds since the Unix epoch.
 */

/** Plain Cartesian vector. The frame is given by the type that holds it. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Position (km) and velocity (km/s) in the TEME frame (True Equator, Mean
 * Equinox), the native output frame of SGP4. TEME is quasi-inertial.
 */
export interface TemeState {
  positionKm: Vec3;
  velocityKmS: Vec3;
}

/**
 * Position (km) and velocity (km/s) in the Earth-fixed frame (ECEF).
 *
 * Here "ECEF" is strictly PEF (Pseudo Earth Fixed): TEME rotated by GMST, with
 * no polar motion applied. See `coordinate-transformations.ts` for the error
 * budget. `velocityKmS` is the true Earth-relative velocity (the Earth's
 * rotation, omega x r, has been removed).
 */
export interface EcefState {
  positionKm: Vec3;
  velocityKmS: Vec3;
}

/** WGS84 geodetic coordinates. */
export interface Geodetic {
  /** Geodetic latitude, degrees, [-90, 90]. */
  latitudeDeg: number;
  /** Longitude, degrees, wrapped to (-180, 180]. */
  longitudeDeg: number;
  /** Height above the WGS84 ellipsoid, kilometers. */
  altitudeKm: number;
}

/** Topocentric East/North/Up vector relative to an observer, kilometers. */
export interface Enu {
  eastKm: number;
  northKm: number;
  upKm: number;
}

/** Observer-relative look angles. */
export interface LookAngles {
  /** Azimuth, degrees clockwise from true north, [0, 360). 0 when the target is at the zenith. */
  azimuthDeg: number;
  /** Elevation above the local horizontal plane, degrees, [-90, 90]. Geometric, no refraction. */
  elevationDeg: number;
  /** Slant range, kilometers. */
  rangeKm: number;
  /** Range rate, km/s. Positive means the target is moving away (receding). */
  rangeRateKmS: number;
}

/**
 * Everything derived from one SGP4 evaluation of one satellite at one instant.
 * Produced by `computeSatelliteState` in `core/orbit/satellite-propagator.ts`.
 */
export interface SatelliteState {
  /** UTC ms of the evaluation (simulation time, not wall-clock time). */
  timeMs: number;
  teme: TemeState;
  ecef: EcefState;
  geodetic: Geodetic;
  /** Magnitude of the TEME (inertial) velocity, km/s. */
  inertialSpeedKmS: number;
  /** Greenwich Mean Sidereal Time used for the TEME -> ECEF rotation, radians. */
  gmstRad: number;
}
