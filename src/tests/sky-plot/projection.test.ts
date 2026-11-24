import { describe, expect, it } from 'vitest';
import { arrowMarks, elevationRadius, projectAzEl, visibleSegments } from '../../components/sky-plot/sky-projection';

const R = 100;

describe('projectAzEl', () => {
  it('puts the zenith at the center and the horizon on the outer ring', () => {
    const z = projectAzEl(123, 90, R);
    expect(z.x).toBeCloseTo(0, 12);
    expect(z.y).toBeCloseTo(0, 12);
    expect(Math.hypot(projectAzEl(77, 0, R).x, projectAzEl(77, 0, R).y)).toBeCloseTo(R, 12);
  });

  it('uses north up, east right, south down, west left', () => {
    const n = projectAzEl(0, 0, R);
    const e = projectAzEl(90, 0, R);
    const s = projectAzEl(180, 0, R);
    const w = projectAzEl(270, 0, R);
    expect([n.x, n.y].map((v) => Math.round(v) + 0)).toEqual([0, -R]); // up on screen
    expect([e.x, e.y].map((v) => Math.round(v) + 0)).toEqual([R, 0]);
    expect([s.x, s.y].map((v) => Math.round(v) + 0)).toEqual([0, R]);
    expect([w.x, w.y].map((v) => Math.round(v) + 0)).toEqual([-R, 0]);
  });

  it('spaces elevation rings linearly in zenith angle', () => {
    expect(elevationRadius(45, R)).toBeCloseTo(50, 12);
    expect(elevationRadius(15, R)).toBeCloseTo((75 / 90) * R, 12);
    expect(Math.hypot(projectAzEl(30, 60, R).x, projectAzEl(30, 60, R).y)).toBeCloseTo(elevationRadius(60, R), 12);
  });
});

describe('visibleSegments', () => {
  const s = (timeMs: number, azimuthDeg: number, elevationDeg: number) => ({ timeMs, azimuthDeg, elevationDeg });

  it('drops below-horizon samples and clips crossings onto the horizon', () => {
    const segs = visibleSegments([s(0, 90, -10), s(10, 90, 10), s(20, 90, 30), s(30, 90, 10), s(40, 90, -10)], R);
    expect(segs).toHaveLength(1);
    const seg = segs[0]!;
    expect(seg).toHaveLength(5);
    expect(Math.hypot(seg[0]!.x, seg[0]!.y)).toBeCloseTo(R, 9);
    expect(seg[0]!.timeMs).toBeCloseTo(5, 9);
    expect(Math.hypot(seg[4]!.x, seg[4]!.y)).toBeCloseTo(R, 9);
    expect(seg[4]!.timeMs).toBeCloseTo(35, 9);
  });

  it('splits separate rises into separate polylines', () => {
    const segs = visibleSegments([s(0, 0, 5), s(1, 0, -5), s(2, 0, -5), s(3, 180, 5), s(4, 180, 6)], R);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(2);
    expect(segs[1]).toHaveLength(3);
  });

  it('crosses north without a wrap artefact', () => {
    // 350 -> 10 deg azimuth crosses north; the polyline must stay near the top.
    const segs = visibleSegments([s(0, 350, 20), s(1, 10, 20)], R);
    for (const p of segs[0]!) expect(p.y).toBeLessThan(0);
  });

  it('respects a non-zero minimum elevation', () => {
    expect(visibleSegments([s(0, 0, 5), s(1, 0, 8)], R, 10)).toEqual([]);
  });
});

describe('arrowMarks', () => {
  it('places marks along the path pointing in the direction of travel', () => {
    const marks = arrowMarks([{ x: 0, y: 0 }, { x: 100, y: 0 }], 25);
    expect(marks).toHaveLength(4);
    for (const m of marks) {
      expect(m.angleDeg).toBeCloseTo(0, 9);
      expect(m.y).toBe(0);
    }
    expect(marks[0]!.x).toBeCloseTo(12.5, 9);
    const down = arrowMarks([{ x: 0, y: 0 }, { x: 0, y: 50 }], 40);
    expect(down[0]!.angleDeg).toBeCloseTo(90, 9);
  });

  it('skips paths that are too short', () => {
    expect(arrowMarks([{ x: 0, y: 0 }, { x: 3, y: 0 }], 40)).toEqual([]);
  });
});
