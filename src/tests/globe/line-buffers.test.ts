import { describe, expect, it } from 'vitest';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { InterleavedBufferAttribute } from 'three';
import { lineCapacity, updateLineColors, updateLinePositions } from '../../components/ground-track/line-buffers';

const poly = (n: number, k: number) => Float32Array.from({ length: n * 3 }, (_, i) => i * k);
const buf = (g: LineGeometry, name: string) => (g.getAttribute(name) as InterleavedBufferAttribute).data;

/**
 * What WebGLRenderer does with an instanced geometry: on the first draw it
 * caches the instance limit from the bound buffers (WebGLBindingStates) and
 * clears it only when the geometry is disposed (WebGLGeometries). The count
 * it draws is min(instanceCount, that limit).
 */
function fakeRenderer(g: LineGeometry) {
  const cached = g as unknown as { _maxInstanceCount?: number };
  g.addEventListener('dispose', () => delete cached._maxInstanceCount);
  return {
    draw(): number {
      cached._maxInstanceCount ??= buf(g, 'instanceStart').count;
      return Math.min(g.instanceCount, cached._maxInstanceCount);
    },
  };
}

describe('LineGeometry in-place updates', () => {
  it('writes the same segments as setColors/setPositions, without replacing the buffers', () => {
    const g = new LineGeometry();
    updateLinePositions(g, poly(5, 1));
    updateLineColors(g, poly(5, 0.01));
    const posBuf = buf(g, 'instanceStart');
    const colBuf = buf(g, 'instanceColorStart');
    const versionBefore = colBuf.version;

    const ref = new LineGeometry();
    ref.setPositions(poly(5, 2));
    ref.setColors(poly(5, 0.02));

    updateLinePositions(g, poly(5, 2));
    updateLineColors(g, poly(5, 0.02));
    expect(buf(g, 'instanceStart')).toBe(posBuf);
    expect(buf(g, 'instanceColorStart')).toBe(colBuf);
    expect(g.instanceCount).toBe(4);
    const used = 4 * 6;
    expect(Array.from(posBuf.array).slice(0, used)).toEqual(Array.from(buf(ref, 'instanceStart').array));
    expect(Array.from(colBuf.array).slice(0, used)).toEqual(Array.from(buf(ref, 'instanceColorStart').array));
    expect(colBuf.version).toBeGreaterThan(versionBefore);
    expect(g.boundingSphere?.radius).toBeCloseTo(ref.boundingSphere!.radius, 5);
  });

  it('draws every segment after the polyline grows past the first-drawn length', () => {
    // Regression: the ground track kept its old length when "revolutions ahead"
    // went from 1 to 3, because setPositions alone never cleared the renderer's
    // cached instance limit.
    const g = new LineGeometry();
    const renderer = fakeRenderer(g);
    updateLinePositions(g, poly(10, 1));
    updateLineColors(g, poly(10, 0.01));
    expect(renderer.draw()).toBe(9);

    updateLinePositions(g, poly(40, 1));
    updateLineColors(g, poly(40, 0.01));
    expect(renderer.draw()).toBe(39);
    expect(buf(g, 'instanceColorStart').count).toBe(lineCapacity(g));
  });

  it('shrinks and regrows within capacity in place, drawing only the real segments', () => {
    const g = new LineGeometry();
    const renderer = fakeRenderer(g);
    updateLinePositions(g, poly(40, 1));
    updateLineColors(g, poly(40, 0.01));
    renderer.draw();
    const posBuf = buf(g, 'instanceStart');
    const colBuf = buf(g, 'instanceColorStart');

    updateLinePositions(g, poly(12, 1));
    updateLineColors(g, poly(12, 0.01));
    expect(renderer.draw()).toBe(11);
    // Unused segments are zero-length at the last vertex, so the bounds match the real line.
    const ref = new LineGeometry();
    ref.setPositions(poly(12, 1));
    expect(g.boundingSphere?.radius).toBeCloseTo(ref.boundingSphere!.radius, 5);
    expect(g.boundingSphere?.center.distanceTo(ref.boundingSphere!.center)).toBeCloseTo(0, 5);

    updateLinePositions(g, poly(39, 1));
    updateLineColors(g, poly(39, 0.01));
    expect(renderer.draw()).toBe(38);
    expect(buf(g, 'instanceStart')).toBe(posBuf);
    expect(buf(g, 'instanceColorStart')).toBe(colBuf);
  });

  it('keeps headroom on growth so a sample or two more does not reallocate', () => {
    const g = new LineGeometry();
    updateLinePositions(g, poly(100, 1));
    const posBuf = buf(g, 'instanceStart');
    expect(lineCapacity(g)).toBeGreaterThan(99);
    updateLinePositions(g, poly(102, 1));
    expect(buf(g, 'instanceStart')).toBe(posBuf);
    expect(g.instanceCount).toBe(101);
  });
});
