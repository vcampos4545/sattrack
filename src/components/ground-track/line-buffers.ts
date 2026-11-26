/**
 * In-place updates for `LineGeometry` (fat lines).
 *
 * `LineGeometry.setPositions` / `setColors` allocate a new interleaved buffer
 * on every call, which also makes Three.js create a new GPU buffer. The
 * ground-track colors and the footprint outline change every frame during
 * fast playback, so they write into the existing buffers instead.
 *
 * LineGeometry stores a polyline of n vertices as n - 1 segments, each
 * [start xyz, end xyz] (6 floats), for both positions and colors.
 *
 * Buffers have a segment capacity that can exceed the current polyline. Unused
 * segments are filled as zero-length copies of the last vertex (invisible, and
 * they keep the bounds exact) and `instanceCount` is set to the real segment
 * count. A polyline longer than the capacity needs a bigger buffer, and that
 * goes through `geometry.dispose()` first: WebGLRenderer caches the instance
 * limit of an instanced geometry (`_maxInstanceCount`) on its first draw and
 * clears it only on dispose, so a grown buffer set without it is still drawn
 * at the old segment count.
 */
import type { InterleavedBufferAttribute } from 'three';
import type { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

/** Extra capacity on growth, so a track that gains a sample or two does not reallocate again. */
const HEADROOM = 1.25;

/** Segment capacity of an existing segment buffer, or 0 when it cannot be written in place. */
function capacityOf(attr: InterleavedBufferAttribute | undefined): number {
  return attr && attr.data.stride === 6 ? attr.data.count : 0;
}

/** Segment capacity of the geometry's position buffer (0 before the first positions). */
export function lineCapacity(geometry: LineGeometry): number {
  return capacityOf(geometry.getAttribute('instanceStart') as InterleavedBufferAttribute | undefined);
}

/**
 * Writes a polyline as segments into `out` (capacity * 6 floats), padding the
 * remaining segments with zero-length ones at the last vertex.
 */
function writeSegments(out: Float32Array, capacity: number, polyline: ArrayLike<number>): void {
  const segments = polyline.length / 3 - 1;
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
  const l = polyline.length - 3;
  const x = polyline[l]!;
  const y = polyline[l + 1]!;
  const z = polyline[l + 2]!;
  for (let o = segments * 6; o < capacity * 6; o += 3) {
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
  }
}

/** A polyline of `capacity + 1` vertices: `polyline` followed by copies of its last vertex. */
function padPolyline(polyline: ArrayLike<number>, capacity: number): Float32Array {
  const out = new Float32Array((capacity + 1) * 3);
  out.set(polyline as ArrayLike<number>);
  const l = polyline.length - 3;
  for (let o = polyline.length; o < out.length; o += 3) {
    out[o] = polyline[l]!;
    out[o + 1] = polyline[l + 1]!;
    out[o + 2] = polyline[l + 2]!;
  }
  return out;
}

/**
 * Sets per-vertex colors ([r, g, b, ...], one triple per polyline vertex).
 * Call after the positions for the same polyline: the color buffer follows the
 * position buffer's capacity.
 */
export function updateLineColors(geometry: LineGeometry, colors: Float32Array): void {
  const segments = colors.length / 3 - 1;
  if (segments < 1) return;
  const capacity = Math.max(lineCapacity(geometry), segments);
  const attr = geometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute | undefined;
  if (capacityOf(attr) === capacity) {
    writeSegments(attr!.data.array as Float32Array, capacity, colors);
    attr!.data.needsUpdate = true;
  } else {
    geometry.setColors(padPolyline(colors, capacity));
  }
}

/** Sets polyline vertex positions ([x, y, z, ...]) and refreshes the draw count and bounds. */
export function updateLinePositions(geometry: LineGeometry, positions: Float32Array): void {
  const segments = positions.length / 3 - 1;
  if (segments < 1) return;
  const attr = geometry.getAttribute('instanceStart') as InterleavedBufferAttribute | undefined;
  const capacity = capacityOf(attr);
  if (segments <= capacity) {
    writeSegments(attr!.data.array as Float32Array, capacity, positions);
    attr!.data.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  } else {
    // Growing: drop the GPU buffers and the renderer's cached instance limit.
    if (attr) geometry.dispose();
    geometry.setPositions(padPolyline(positions, Math.ceil(segments * HEADROOM)));
  }
  geometry.instanceCount = segments;
}
