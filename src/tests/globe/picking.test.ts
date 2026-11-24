import { Matrix4, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { isOccludedBySphere, pickNearestMarker } from '../../components/globe/globe-picking';

function setup() {
  const cam = new PerspectiveCamera(40, 800 / 600, 0.01, 100);
  cam.position.set(0, 0, 4);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const vp = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  return { camera: [0, 0, 4] as const, viewProjection: vp.elements, width: 800, height: 600 };
}

describe('isOccludedBySphere', () => {
  it('detects points behind the Earth and not those in front or beside it', () => {
    const cam = [0, 0, 4] as const;
    expect(isOccludedBySphere(cam, 0, 0, -1.1, 1)).toBe(true);
    expect(isOccludedBySphere(cam, 0, 0, 1.1, 1)).toBe(false);
    expect(isOccludedBySphere(cam, 1.5, 0, -1, 1)).toBe(false);
  });
});

describe('pickNearestMarker', () => {
  const base = setup();
  it('picks the marker under the cursor (screen center = origin direction)', () => {
    const positions = new Float32Array([0, 0, 1.1, 0.5, 0.5, 1.1]);
    const i = pickNearestMarker({ ...base, positions, valid: [1, 1], count: 2, pointerX: 400, pointerY: 300, radiusPx: 8 });
    expect(i).toBe(0);
  });

  it('ignores invalid, occluded and far-away markers', () => {
    const positions = new Float32Array([0, 0, 1.1, 0, 0, -1.2, 0.5, 0.5, 1.1]);
    expect(pickNearestMarker({ ...base, positions, valid: [0, 1, 1], count: 3, pointerX: 400, pointerY: 300, radiusPx: 8 })).toBe(-1);
  });

  it('maps +y up on screen', () => {
    const positions = new Float32Array([0, 0.3, 1.1]);
    const below = pickNearestMarker({ ...base, positions, valid: [1], count: 1, pointerX: 400, pointerY: 400, radiusPx: 30 });
    expect(below).toBe(-1);
    // Point sits above the center: find it with a generous radius above.
    let found = -1;
    for (let y = 300; y > 0 && found < 0; y -= 5) {
      found = pickNearestMarker({ ...base, positions, valid: [1], count: 1, pointerX: 400, pointerY: y, radiusPx: 4 });
    }
    expect(found).toBe(0);
  });
});
