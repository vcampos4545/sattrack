/**
 * Mapping between orbit-module frames and the Three.js scene of the primary
 * globe. Framework-free so it can be unit tested.
 *
 * Scene frame = TEME, re-axed for Three.js and scaled to Earth radii
 * -----------------------------------------------------------------
 * The globe scene is quasi-inertial: world axes are TEME axes, so orbit paths
 * are closed ellipses and the camera does not spin with the Earth. The Earth
 * mesh (and everything fixed to the ground: grid, observer) sits in a group
 * rotated by GMST, exactly the TEME <-> ECEF (PEF) rotation used by
 * `coordinate-transformations.ts`. A satellite drawn at its TEME position
 * therefore appears over the same ground point that `ecefToGeodetic` reports.
 *
 * Three.js is y-up, TEME/ECEF are z-up. The axis map is a proper rotation
 * (determinant +1, handedness preserved):
 *
 *   scene.x =  frame.x / A
 *   scene.y =  frame.z / A        (north pole up)
 *   scene.z = -frame.y / A
 *
 * where A = WGS84 equatorial radius, so 1 scene unit = 6378.137 km.
 *
 * With this map, a rotation about the TEME z axis by +theta is a Three.js
 * rotation about +y by +theta (`group.rotation.y = gmst`), and longitude 0 /
 * 90 E land on +x / -z, which is where Three.js's `SphereGeometry` puts u =
 * 0.5 / 0.75 of an equirectangular texture. Both facts are checked in
 * `src/tests/globe/scene-frame.test.ts`.
 *
 * The Earth mesh is scaled by b/a along y to the WGS84 ellipsoid. Its texture
 * is laid out by parametric latitude rather than geodetic latitude (max
 * difference 0.1 degrees, ~11 km), which is below the texture's resolution.
 */
import { WGS84_A_KM, WGS84_B_KM } from '../../core/orbit/constants';
import type { Vec3 } from '../../types/orbital';

/** Kilometers per scene unit. */
export const SCENE_UNIT_KM = WGS84_A_KM;

/** y scale of the Earth mesh: polar / equatorial radius. */
export const EARTH_POLAR_SCALE = WGS84_B_KM / WGS84_A_KM;

/** Writes the scene coordinates of a TEME or ECEF vector (km) into `out[offset..offset+2]`. */
export function writeSceneFromKm(
  x: number,
  y: number,
  z: number,
  out: { [index: number]: number },
  offset = 0,
): void {
  out[offset] = x / SCENE_UNIT_KM;
  out[offset + 1] = z / SCENE_UNIT_KM;
  out[offset + 2] = -y / SCENE_UNIT_KM;
}

/** Scene coordinates of a TEME or ECEF vector in km, as a tuple. */
export function sceneFromKm(v: Vec3): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  writeSceneFromKm(v.x, v.y, v.z, out);
  return out;
}

/** Inverse of `sceneFromKm` (km, TEME or ECEF depending on the input frame). */
export function kmFromScene(s: readonly [number, number, number]): Vec3 {
  return { x: s[0] * SCENE_UNIT_KM, y: -s[2] * SCENE_UNIT_KM, z: s[1] * SCENE_UNIT_KM };
}

/**
 * Rotates a scene-frame vector about +y by `angleRad`, the Three.js
 * convention used by `Object3D.rotation.y`. With `angleRad = gmst` this
 * takes Earth-fixed scene coordinates to inertial (TEME) scene coordinates.
 */
export function rotateSceneY(s: readonly [number, number, number], angleRad: number): [number, number, number] {
  const c = Math.cos(angleRad);
  const sn = Math.sin(angleRad);
  return [c * s[0] + sn * s[2], s[1], -sn * s[0] + c * s[2]];
}
