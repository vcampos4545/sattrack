/**
 * Antenna pointing types. No hardware is driven yet: these describe what a
 * future rotator controller would feed the sky plot (spec section 16), so the
 * plot can show commanded vs. actual pointing next to the satellite.
 */

/** A pointing direction, degrees. Azimuth clockwise from true north, [0, 360). */
export interface AzEl {
  azimuthDeg: number;
  /** Degrees above the local horizontal plane. */
  elevationDeg: number;
}

/**
 * Live antenna pointing for the sky plot overlay. Every field is optional:
 * a receive-only setup may report only `actual`, a dry run only `commanded`.
 */
export interface AntennaPointing {
  /** Where the controller told the rotator to point. */
  commanded?: AzEl | null;
  /** Where the rotator reports it is pointing (encoder / feedback). */
  actual?: AzEl | null;
  /** Short name of the rotator or station, shown in the readout. */
  label?: string;
}
