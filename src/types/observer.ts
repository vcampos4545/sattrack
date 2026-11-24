/** Ground observer (station) location. */
export interface ObserverLocation {
  /** Geodetic latitude, degrees, [-90, 90]. */
  latitudeDeg: number;
  /** Longitude, degrees, [-180, 180]. East positive. */
  longitudeDeg: number;
  /** Height above the WGS84 ellipsoid, meters (UI unit). Converted to km in core math. */
  altitudeM: number;
  /** Optional human label, e.g. a place name. */
  label?: string;
  /** How the location was set. `default` means the user has not configured one yet. */
  source: 'default' | 'manual' | 'geolocation';
}

/** Field-level validation errors returned by `validateObserverLocation`. */
export type ObserverValidationErrors = Partial<
  Record<'latitudeDeg' | 'longitudeDeg' | 'altitudeM', string>
>;
