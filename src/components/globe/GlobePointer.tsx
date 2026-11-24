import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Matrix4, Vector3 } from 'three';
import { useSatelliteStore } from '../../stores/satellite-store';
import { placeLabel, useGlobeContext } from './globe-context';
import { useGlobeViewStore } from './globe-view-store';
import { pickNearestMarker } from './globe-picking';

/** Hit radius around a marker, CSS pixels. */
const PICK_RADIUS_PX = 9;
/** A press that moves farther than this is a drag (rotate), not a click. */
const CLICK_SLOP_PX = 5;

const viewProjection = new Matrix4();

/**
 * Hover and click picking for the satellite markers. Listens on the canvas,
 * hit-tests in screen space (globe-picking.ts) once per frame while the
 * pointer is over the globe, and writes the hovered object to the view
 * store. A click (press and release without dragging) selects.
 */
export function GlobePointer() {
  const { markers } = useGlobeContext();
  const gl = useThree((s) => s.gl);
  const pointer = useRef<{ x: number; y: number; inside: boolean; downX: number; downY: number }>({
    x: 0,
    y: 0,
    inside: false,
    downX: NaN,
    downY: NaN,
  });

  const pick = (state: { camera: import('three').Camera; size: { width: number; height: number } }): number | null => {
    const p = pointer.current;
    if (!p.inside) return null;
    const cam = state.camera;
    viewProjection.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const i = pickNearestMarker({
      positions: markers.positions,
      valid: markers.valid,
      count: markers.records.length,
      viewProjection: viewProjection.elements,
      camera: [cam.position.x, cam.position.y, cam.position.z],
      width: state.size.width,
      height: state.size.height,
      pointerX: p.x,
      pointerY: p.y,
      radiusPx: PICK_RADIUS_PX,
    });
    return i >= 0 ? (markers.records[i]?.noradId ?? null) : null;
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const stateRef = useRef<Parameters<typeof pick>[0] | null>(null);

  useEffect(() => {
    const el = gl.domElement;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = local(e);
      Object.assign(pointer.current, { x, y, inside: true });
    };
    const onLeave = () => {
      pointer.current.inside = false;
      useGlobeViewStore.getState().setHovered(null);
    };
    const onDown = (e: PointerEvent) => {
      const { x, y } = local(e);
      Object.assign(pointer.current, { downX: x, downY: y });
    };
    const onUp = (e: PointerEvent) => {
      const { x, y } = local(e);
      const p = pointer.current;
      const moved = Math.hypot(x - p.downX, y - p.downY);
      p.downX = NaN;
      if (!(moved <= CLICK_SLOP_PX) || e.button !== 0 || !stateRef.current) return;
      Object.assign(p, { x, y, inside: true });
      const id = pickRef.current(stateRef.current);
      if (id !== null) useSatelliteStore.getState().select(id);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [gl]);

  useFrame((state) => {
    stateRef.current = state;
    // Markers move under a still cursor, so re-test every frame while inside.
    if (!pointer.current.inside) return;
    const id = pick(state);
    useGlobeViewStore.getState().setHovered(id);
    gl.domElement.style.cursor = id !== null ? 'pointer' : '';
  });

  return <HoverLabelAnchor />;
}

/** Keeps the hover label (a DOM overlay, see EarthGlobe) next to the hovered marker. */
function HoverLabelAnchor() {
  const { markers, labels } = useGlobeContext();
  const world = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    const id = useGlobeViewStore.getState().hoveredId;
    const i = id === null ? undefined : markers.indexById.get(id);
    const ok = i !== undefined && markers.valid[i] === 1;
    if (ok) world.current.set(markers.positions[i * 3]!, markers.positions[i * 3 + 1]!, markers.positions[i * 3 + 2]!);
    placeLabel(labels.hover, world.current, camera, size, ok);
  });
  return null;
}
