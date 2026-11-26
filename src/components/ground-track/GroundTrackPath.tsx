import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, ConeGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { splitIndex, type GroundTrackPoint } from '../../core/orbit/ground-track';
import { getSimTimeMs } from '../../stores/time-store';
import { updateLineColors, updateLinePositions } from './line-buffers';
import { geoArrayToPositions, GT_COLORS, LIFT } from './scene-geometry';

interface GroundTrackPathProps {
  /** Time-ordered sub-satellite points covering at least [now - pastMs, now + futureMs]. */
  points: readonly GroundTrackPoint[];
  pastMs: number;
  futureMs: number;
}

/** One direction arrow every this many samples (~12 per revolution at the default spacing). */
const ARROW_EVERY = 20;
const MAX_ARROWS = 256;

const PAST = new Color(GT_COLORS.past);
const FUTURE = new Color(GT_COLORS.future);
const FADE = new Color(GT_COLORS.fade);
const tmpColor = new Color();

/**
 * Past and predicted ground track as one fat polyline with per-vertex colors.
 *
 * The geometry is rebuilt only when the sampled track changes (a new window,
 * a new satellite). Each frame only the split between past and future is
 * checked against simulation time; colors are rewritten when it moves to the
 * next sample. Past fades out toward the start of the window, future fades
 * toward its end. Cones along the predicted part show the direction of travel.
 */
export function GroundTrackPath({ points, pastMs, futureMs }: GroundTrackPathProps) {
  const line = useMemo(() => {
    const material = new LineMaterial({ vertexColors: true, linewidth: 2, worldUnits: false, transparent: true });
    return new Line2(new LineGeometry(), material);
  }, []);
  const arrows = useMemo(() => {
    const geometry = new ConeGeometry(0.011, 0.034, 10);
    const material = new MeshBasicMaterial({ color: GT_COLORS.future });
    const mesh = new InstancedMesh(geometry, material, MAX_ARROWS);
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }, []);
  /** Candidate arrow transforms along the whole sampled track, in time order. */
  const arrowSlots = useRef<{ timeMs: number; matrix: Matrix4 }[]>([]);
  const lastSplit = useRef(-1);
  /** Reused per-vertex color scratch; reallocated only when the track length changes. */
  const colorScratch = useRef(new Float32Array(0));

  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
      arrows.geometry.dispose();
      (arrows.material as MeshBasicMaterial).dispose();
    },
    [line, arrows],
  );

  // Positions and arrow transforms: only when the sampled track changes.
  useEffect(() => {
    if (points.length < 2) return;
    const positions = geoArrayToPositions(points, LIFT.track);
    // Grows the GPU buffers when the track gets longer (e.g. more revolutions ahead).
    updateLinePositions(line.geometry, positions);
    line.computeLineDistances();

    const up = new Vector3(0, 1, 0);
    const a = new Vector3();
    const b = new Vector3();
    const dir = new Vector3();
    const q = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    const slots: { timeMs: number; matrix: Matrix4 }[] = [];
    for (let i = ARROW_EVERY; i < points.length - 1; i += ARROW_EVERY) {
      a.fromArray(positions, (i - 1) * 3);
      b.fromArray(positions, (i + 1) * 3);
      dir.subVectors(b, a);
      if (dir.lengthSq() === 0) continue;
      q.setFromUnitVectors(up, dir.normalize());
      a.fromArray(positions, i * 3);
      slots.push({ timeMs: points[i]!.timeMs, matrix: new Matrix4().compose(a, q, scale) });
    }
    arrowSlots.current = slots;
    lastSplit.current = -1;
  }, [points, line, arrows]);

  useFrame(() => {
    if (points.length < 2) return;
    const now = getSimTimeMs();
    const split = splitIndex(points, now);
    if (split === lastSplit.current) return;
    lastSplit.current = split;

    if (colorScratch.current.length !== points.length * 3) colorScratch.current = new Float32Array(points.length * 3);
    const colors = colorScratch.current;
    const c = tmpColor;
    for (let i = 0; i < points.length; i++) {
      const dt = points[i]!.timeMs - now;
      // 0 next to "now", 1 at the end of the configured window (and beyond).
      const f = dt <= 0 ? Math.min(1, -dt / Math.max(1, pastMs)) : Math.min(1, dt / Math.max(1, futureMs));
      c.copy(dt <= 0 ? PAST : FUTURE).lerp(FADE, dt <= 0 ? 0.15 + 0.8 * f : 0.75 * f * f);
      c.toArray(colors, i * 3);
    }
    // During fast playback the split moves every frame: write in place.
    updateLineColors(line.geometry, colors);

    // Arrows on the predicted track, within the future window only.
    let count = 0;
    for (const slot of arrowSlots.current) {
      if (slot.timeMs <= now || slot.timeMs - now > futureMs) continue;
      if (count >= MAX_ARROWS) break;
      arrows.setMatrixAt(count++, slot.matrix);
    }
    arrows.instanceMatrix.needsUpdate = true;
    arrows.count = count;
  });

  if (points.length < 2) return null;
  return (
    <>
      <primitive object={line} />
      <primitive object={arrows} />
    </>
  );
}
