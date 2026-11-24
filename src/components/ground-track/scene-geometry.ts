/**
 * Scene conventions for the ground-track globe. Rendering helpers only: all
 * orbital math comes from core/orbit.
 *
 * The globe is Earth-fixed (it does not spin with time; the ground track is
 * already in Earth-fixed coordinates). Scene axes follow Three.js (y up):
 *
 *   scene x =  ECEF x   (lat 0, lon 0)
 *   scene y =  ECEF z   (north pole)
 *   scene z = -ECEF y   (lat 0, lon 90 W)
 *
 * which is exactly how `SphereGeometry` lays out an equirectangular texture
 * (u = 0.5 on the prime meridian), so geography and texture line up.
 *
 * Points are placed by geodetic latitude on a unit sphere, the same
 * convention as an equirectangular map. The display sphere is not the
 * ellipsoid; it only has to agree with the texture.
 */
import { Vector3 } from 'three';
import { DEG_TO_RAD } from '../../core/orbit/constants';

/** Radius of the globe mesh, scene units. */
export const GLOBE_RADIUS = 1;
/** Small lifts above the surface to avoid z-fighting with the globe. */
export const LIFT = {
  footprintFill: 1.002,
  footprintLine: 1.003,
  track: 1.004,
  marker: 1.006,
} as const;

/** Geodetic degrees to a scene position at radius `r`. Writes into `out` when given. */
export function geoToVector(latDeg: number, lonDeg: number, r = GLOBE_RADIUS, out = new Vector3()): Vector3 {
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const c = Math.cos(lat);
  return out.set(r * c * Math.cos(lon), r * Math.sin(lat), -r * c * Math.sin(lon));
}

/** Writes geodetic points into a flat xyz array at radius `r`. */
export function geoArrayToPositions(
  points: readonly { latitudeDeg: number; longitudeDeg: number }[],
  r: number,
  out = new Float32Array(points.length * 3),
): Float32Array {
  const v = new Vector3();
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    geoToVector(p.latitudeDeg, p.longitudeDeg, r, v);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/** Colors used by the ground-track view. Mirrors the design tokens in index.css. */
export const GT_COLORS = {
  past: '#8494b0',
  future: '#4cc2ff',
  footprint: '#f2b84b',
  footprintVisible: '#3ecf8e',
  observer: '#d5deeb',
  observerVisible: '#3ecf8e',
  subPoint: '#ffffff',
  /** Color the track fades toward (roughly the globe's ocean tone). */
  fade: '#0c1628',
} as const;
