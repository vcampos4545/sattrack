import { describe, expect, it } from 'vitest';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { InterleavedBufferAttribute } from 'three';
import { updateLineColors, updateLinePositions } from '../../components/ground-track/line-buffers';

const poly = (n: number, k: number) => Float32Array.from({ length: n * 3 }, (_, i) => i * k);

describe('LineGeometry in-place updates', () => {
  it('matches what setColors/setPositions produce, without replacing the buffers', () => {
    const g = new LineGeometry();
    g.setPositions(poly(5, 1));
    g.setColors(poly(5, 0.01));
    const posBuf = (g.getAttribute('instanceStart') as InterleavedBufferAttribute).data;
    const colBuf = (g.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data;
    const versionBefore = colBuf.version;

    const ref = new LineGeometry();
    ref.setPositions(poly(5, 2));
    ref.setColors(poly(5, 0.02));

    updateLinePositions(g, poly(5, 2));
    updateLineColors(g, poly(5, 0.02));
    expect((g.getAttribute('instanceStart') as InterleavedBufferAttribute).data).toBe(posBuf);
    expect((g.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data).toBe(colBuf);
    expect(Array.from(posBuf.array)).toEqual(
      Array.from((ref.getAttribute('instanceStart') as InterleavedBufferAttribute).data.array),
    );
    expect(Array.from(colBuf.array)).toEqual(
      Array.from((ref.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data.array),
    );
    expect(colBuf.version).toBeGreaterThan(versionBefore);
    expect(g.boundingSphere?.radius).toBeCloseTo(ref.boundingSphere!.radius, 5);
  });

  it('falls back to the allocating setters when the vertex count changes', () => {
    const g = new LineGeometry();
    updateLineColors(g, poly(4, 0.01));
    updateLinePositions(g, poly(4, 1));
    expect(g.instanceCount).toBe(3);
    updateLinePositions(g, poly(6, 1));
    updateLineColors(g, poly(6, 0.01));
    expect(g.instanceCount).toBe(5);
    expect((g.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data.count).toBe(5);
  });
});
