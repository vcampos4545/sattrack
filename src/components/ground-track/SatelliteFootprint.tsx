import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { LiveSatellite } from './live-satellite';
import { geoToVector, GT_COLORS, LIFT } from './scene-geometry';

/** Boundary points per footprint (must match computeFootprint's default). */
const BOUNDARY_POINTS = 128;
/** Concentric rings in the translucent fill, so large footprints follow the curved surface. */
const FILL_RINGS = 12;

/**
 * Coverage footprint of the selected satellite: the boundary from
 * `computeFootprint` (true minimum-elevation contour) as a line, plus a
 * translucent fill. Geometry is rewritten only when the live driver produces
 * a new footprint. The footprint turns green while the observer is inside it.
 */
export function SatelliteFootprint({ live }: { live: RefObject<LiveSatellite> }) {
  const outline = useMemo(() => {
    const material = new LineMaterial({ color: GT_COLORS.footprint, linewidth: 1.5, worldUnits: false, transparent: true, opacity: 0.95 });
    const line = new Line2(new LineGeometry(), material);
    line.visible = false;
    return line;
  }, []);

  const fill = useMemo(() => {
    // Grid of (FILL_RINGS + 1) rings x BOUNDARY_POINTS; ring 0 collapses to the center.
    const geometry = new BufferGeometry();
    const vertexCount = (FILL_RINGS + 1) * BOUNDARY_POINTS;
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertexCount * 3), 3));
    const index: number[] = [];
    for (let k = 0; k < FILL_RINGS; k++) {
      for (let i = 0; i < BOUNDARY_POINTS; i++) {
        const a = k * BOUNDARY_POINTS + i;
        const b = k * BOUNDARY_POINTS + ((i + 1) % BOUNDARY_POINTS);
        const c = a + BOUNDARY_POINTS;
        const d = b + BOUNDARY_POINTS;
        index.push(a, c, d, a, d, b);
      }
    }
    geometry.setIndex(index);
    const material = new MeshBasicMaterial({
      color: GT_COLORS.footprint,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    return mesh;
  }, []);

  useEffect(
    () => () => {
      outline.geometry.dispose();
      outline.material.dispose();
      fill.geometry.dispose();
      (fill.material as MeshBasicMaterial).dispose();
    },
    [outline, fill],
  );

  const seen = useRef(-1);
  const wasInside = useRef<boolean | null>(null);

  useFrame(() => {
    const cur = live.current;
    if (cur.footprintVersion !== seen.current) {
      seen.current = cur.footprintVersion;
      const fp = cur.footprint;
      const ok = !!fp && fp.boundary.length === BOUNDARY_POINTS;
      outline.visible = ok;
      fill.visible = ok;
      if (fp && ok) {
        // Outline: closed loop.
        const pts = new Float32Array((BOUNDARY_POINTS + 1) * 3);
        const v = new Vector3();
        for (let i = 0; i <= BOUNDARY_POINTS; i++) {
          const b = fp.boundary[i % BOUNDARY_POINTS]!;
          geoToVector(b.latitudeDeg, b.longitudeDeg, LIFT.footprintLine, v).toArray(pts, i * 3);
        }
        outline.geometry.setPositions(pts);

        // Fill: interpolate from the sub-satellite direction to each boundary
        // direction and push back onto the sphere.
        const center = geoToVector(fp.subSatellite.latitudeDeg, fp.subSatellite.longitudeDeg, 1);
        const edge = new Vector3();
        const pos = fill.geometry.getAttribute('position') as BufferAttribute;
        for (let i = 0; i < BOUNDARY_POINTS; i++) {
          const b = fp.boundary[i]!;
          geoToVector(b.latitudeDeg, b.longitudeDeg, 1, edge);
          for (let k = 0; k <= FILL_RINGS; k++) {
            v.copy(center).lerp(edge, k / FILL_RINGS).setLength(LIFT.footprintFill);
            pos.setXYZ(k * BOUNDARY_POINTS + i, v.x, v.y, v.z);
          }
        }
        pos.needsUpdate = true;
      }
    }
    if (cur.observerInside !== wasInside.current) {
      wasInside.current = cur.observerInside;
      const color = new Color(cur.observerInside ? GT_COLORS.footprintVisible : GT_COLORS.footprint);
      outline.material.color.copy(color);
      const fillMat = fill.material as MeshBasicMaterial;
      fillMat.color.copy(color);
      fillMat.opacity = cur.observerInside ? 0.16 : 0.08;
    }
  });

  return (
    <>
      <primitive object={fill} />
      <primitive object={outline} />
    </>
  );
}
