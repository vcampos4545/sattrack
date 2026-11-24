import { createContext, useContext } from 'react';
import { Vector3, type Camera } from 'three';
import type { SatelliteRecord } from '../../types/satellite';
import type { BulkPropagator } from './propagation/bulk-propagator';

/**
 * Per-frame data shared between the globe's scene components. Mutable on
 * purpose: it is written in the render loop and must not trigger React renders.
 */
export interface MarkerFrame {
  records: SatelliteRecord[];
  /** Index of each record by NORAD id. */
  indexById: Map<number, number>;
  /** Scene positions of the markers drawn this frame. */
  positions: Float32Array;
  /** 1 when slot i has a position this frame. */
  valid: Uint8Array;
}

/** DOM overlay elements (outside the canvas) that scene components position each frame. */
export interface GlobeLabels {
  hover: HTMLDivElement | null;
  observer: HTMLDivElement | null;
}

export interface GlobeContextValue {
  labels: GlobeLabels;
  propagator: BulkPropagator;
  markers: MarkerFrame;
  /** Scene position of the selected object this frame (valid flag alongside). */
  selected: { position: Vector3; valid: boolean };
}

export const GlobeContext = createContext<GlobeContextValue | null>(null);

export function useGlobeContext(): GlobeContextValue {
  const ctx = useContext(GlobeContext);
  if (!ctx) throw new Error('useGlobeContext must be used inside the primary globe');
  return ctx;
}

export function createMarkerFrame(): MarkerFrame {
  return { records: [], indexById: new Map(), positions: new Float32Array(0), valid: new Uint8Array(0) };
}

const projected = new Vector3();

/**
 * Moves a DOM label to the screen position of a scene point. Hidden when the
 * point is behind the camera or `visible` is false. Writes styles directly so
 * nothing re-renders.
 */
export function placeLabel(
  el: HTMLElement | null,
  world: Vector3,
  camera: Camera,
  size: { width: number; height: number },
  visible: boolean,
): void {
  if (!el) return;
  projected.copy(world).project(camera);
  const show = visible && projected.z < 1;
  el.style.visibility = show ? 'visible' : 'hidden';
  if (!show) return;
  const x = ((projected.x + 1) / 2) * size.width;
  const y = ((1 - projected.y) / 2) * size.height;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
}
