/**
 * Screen-space picking of satellite markers. Framework-free (takes a plain
 * column-major view-projection matrix, as `Matrix4.elements` stores it) so it
 * can be unit tested.
 *
 * Markers are drawn as fixed-size points, so the useful hit test is "closest
 * marker to the cursor in pixels", not a ray-mesh intersection. Markers hidden
 * behind the Earth are skipped. The occlusion test uses a sphere of radius 1
 * (the equatorial radius), which misses the polar flattening by 21 km. That
 * only matters for objects grazing the limb.
 */

export interface PickInput {
  /** Scene positions, [x, y, z, ...]. */
  positions: ArrayLike<number>;
  /** Slot i is pickable when `valid[i]` is non-zero. */
  valid: ArrayLike<number>;
  count: number;
  /** Column-major 4x4 projection * view matrix. */
  viewProjection: ArrayLike<number>;
  /** Camera position, scene units. */
  camera: readonly [number, number, number];
  /** Viewport size and pointer position, CSS pixels from the top-left. */
  width: number;
  height: number;
  pointerX: number;
  pointerY: number;
  /** Hit radius, CSS pixels. */
  radiusPx: number;
  /** Radius of the occluding Earth sphere, scene units. */
  earthRadius?: number;
}

/** True when the segment camera -> point passes through the sphere first. */
export function isOccludedBySphere(
  camera: readonly [number, number, number],
  px: number,
  py: number,
  pz: number,
  radius: number,
): boolean {
  const dx = px - camera[0];
  const dy = py - camera[1];
  const dz = pz - camera[2];
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (camera[0] * dx + camera[1] * dy + camera[2] * dz);
  const c = camera[0] * camera[0] + camera[1] * camera[1] + camera[2] * camera[2] - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return false;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  // Hit strictly between camera (t=0) and the point (t=1).
  return (t1 > 0 && t1 < 1) || (t2 > 0 && t2 < 1);
}

/** Index of the nearest visible marker within `radiusPx` of the pointer, or -1. */
export function pickNearestMarker(input: PickInput): number {
  const { positions, valid, count, viewProjection: m, camera, width, height, pointerX, pointerY } = input;
  const r2 = input.radiusPx * input.radiusPx;
  const earth = input.earthRadius ?? 1;
  let best = -1;
  let bestD2 = r2;
  for (let i = 0; i < count; i++) {
    if (!valid[i]) continue;
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    const w = (m[3] as number) * x + (m[7] as number) * y + (m[11] as number) * z + (m[15] as number);
    if (w <= 0) continue; // behind the camera
    const ndcX = ((m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number)) / w;
    const ndcY = ((m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number)) / w;
    const sx = ((ndcX + 1) / 2) * width;
    const sy = ((1 - ndcY) / 2) * height;
    const d2 = (sx - pointerX) ** 2 + (sy - pointerY) ** 2;
    if (d2 > bestD2) continue;
    if (isOccludedBySphere(camera, x, y, z, earth)) continue;
    best = i;
    bestD2 = d2;
  }
  return best;
}
