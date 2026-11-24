/**
 * Short-step extrapolation of a propagated TEME state, used to move markers
 * smoothly between bulk SGP4 evaluations.
 *
 * Why: bulk propagation runs at a configurable rate (default 1 Hz, see
 * `settings.propagationHz`) while the globe renders at ~60 fps. Rather than
 * re-running SGP4 for every object every frame, each frame advances the last
 * SGP4 state by dt with a third-order Taylor series of two-body motion:
 *
 *   r(dt) = r + v dt + a dt^2 / 2 + j dt^3 / 6
 *   a     = -mu r / |r|^3                                  (two-body acceleration)
 *   j     = da/dt = -mu (v / |r|^3 - 3 (r . v) r / |r|^5)  (jerk)
 *
 * The truncation error grows as dt^4; J2 and drag (which SGP4 includes) are
 * left out and contribute about 0.5 * 1e-5 km/s^2 * dt^2. For a LEO object at
 * dt = 30 s the total is a few meters, at 120 s well under a kilometer. Callers
 * must re-propagate with SGP4 instead of extrapolating past
 * `MAX_EXTRAPOLATION_S`: this is a display interpolator, not a propagator.
 *
 * Units: km, km/s, seconds. Frame: TEME (any inertial frame works).
 */

/** WGS72 gravitational parameter, km^3/s^2. The value SGP4 itself uses. */
export const MU_WGS72_KM3_S2 = 398600.8;

/** Longest step (seconds, either direction) that `extrapolateTwoBody` is used for. */
export const MAX_EXTRAPOLATION_S = 120;

/**
 * Extrapolates the position in slot `i` of flat `[x0, y0, z0, x1, ...]`
 * buffers (the `propagateBatch` layout) by `dtS` seconds and writes it to
 * `out[outOffset..outOffset + 2]`. Allocation-free for per-frame use.
 */
export function extrapolateTwoBody(
  positionsKm: ArrayLike<number>,
  velocitiesKmS: ArrayLike<number>,
  i: number,
  dtS: number,
  out: { [index: number]: number },
  outOffset = 0,
): void {
  const j = i * 3;
  const rx = positionsKm[j] as number;
  const ry = positionsKm[j + 1] as number;
  const rz = positionsKm[j + 2] as number;
  const vx = velocitiesKmS[j] as number;
  const vy = velocitiesKmS[j + 1] as number;
  const vz = velocitiesKmS[j + 2] as number;
  const r2 = rx * rx + ry * ry + rz * rz;
  const r = Math.sqrt(r2);
  const k = -MU_WGS72_KM3_S2 / (r2 * r); // -mu / |r|^3
  const rv = (rx * vx + ry * vy + rz * vz) / r2; // (r . v) / |r|^2
  // a = k r ; j = k (v - 3 rv r)
  const h2 = (dtS * dtS) / 2;
  const h3 = (dtS * dtS * dtS) / 6;
  out[outOffset] = rx + vx * dtS + k * rx * h2 + k * (vx - 3 * rv * rx) * h3;
  out[outOffset + 1] = ry + vy * dtS + k * ry * h2 + k * (vy - 3 * rv * ry) * h3;
  out[outOffset + 2] = rz + vz * dtS + k * rz * h2 + k * (vz - 3 * rv * rz) * h3;
}
