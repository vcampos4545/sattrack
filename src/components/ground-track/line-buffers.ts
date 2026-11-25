/**
 * In-place updates for `LineGeometry` (fat lines).
 *
 * `LineGeometry.setPositions` / `setColors` allocate a new interleaved buffer
 * on every call, which also makes Three.js create a new GPU buffer. The
 * ground-track colors and the footprint outline change every frame during
 * fast playback, so they write into the existing buffers instead and only
 * fall back to the allocating setters when the vertex count changes.
 *
 * LineGeometry stores a polyline of n vertices as n - 1 segments, each
 * [start xyz, end xyz] (6 floats), for both positions and colors.
 */
import type { InterleavedBufferAttribute } from 'three';
import type { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

function writeSegments(attr: InterleavedBufferAttribute | undefined, polyline: ArrayLike<number>): boolean {
  const segments = polyline.length / 3 - 1;
  if (!attr || attr.data.count !== segments || attr.data.stride !== 6) return false;
  const out = attr.data.array as Float32Array;
  for (let i = 0; i < segments; i++) {
    const s = i * 3;
    const o = i * 6;
    out[o] = polyline[s]!;
    out[o + 1] = polyline[s + 1]!;
    out[o + 2] = polyline[s + 2]!;
    out[o + 3] = polyline[s + 3]!;
    out[o + 4] = polyline[s + 4]!;
    out[o + 5] = polyline[s + 5]!;
  }
  attr.data.needsUpdate = true;
  return true;
}

/** Sets per-vertex colors ([r, g, b, ...], one triple per polyline vertex). */
export function updateLineColors(geometry: LineGeometry, colors: Float32Array): void {
  const attr = geometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute | undefined;
  if (!writeSegments(attr, colors)) geometry.setColors(colors);
}

/** Sets polyline vertex positions ([x, y, z, ...]) and refreshes the bounds. */
export function updateLinePositions(geometry: LineGeometry, positions: Float32Array): void {
  const attr = geometry.getAttribute('instanceStart') as InterleavedBufferAttribute | undefined;
  if (!writeSegments(attr, positions)) {
    geometry.setPositions(positions);
    return;
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
