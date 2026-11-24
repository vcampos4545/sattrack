import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, ShaderMaterial } from 'three';
import { extrapolateTwoBody, MAX_EXTRAPOLATION_S } from '../../core/orbit/extrapolation';
import { useSatelliteStore } from '../../stores/satellite-store';
import { useSettingsStore } from '../../stores/settings-store';
import { getSimTimeMs } from '../../stores/time-store';
import { CATEGORY_COLORS } from '../../utils/category-colors';
import { useGlobeContext } from './globe-context';
import { writeSceneFromKm } from './scene-frame';

/** Marker diameter in CSS pixels. */
const MARKER_SIZE_PX = 5;

const vertex = /* glsl */ `
  attribute vec3 color;
  attribute float aVisible;
  uniform float uSize;
  varying vec3 vColor;
  void main() {
    vColor = color;
    gl_PointSize = uSize * aVisible;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    // Bright core, darker rim: reads as a dot against both land and space.
    float rim = smoothstep(0.32, 0.5, d);
    gl_FragColor = vec4(mix(vColor, vColor * 0.35, rim), 1.0);
    #include <colorspace_fragment>
  }
`;

const tmpKm = new Float64Array(3);

/**
 * All visible satellites as one `Points` draw call (a buffer geometry with
 * per-vertex color and visibility, one vertex per object), so thousands of
 * objects cost one draw call and no per-object scene nodes.
 *
 * Positions come from the bulk propagator (SGP4 in a Web Worker at
 * `settings.propagationHz`) and are advanced every frame with the two-body
 * extrapolator, so rendering runs at the display rate while SGP4 runs at the
 * configured rate. Objects SGP4 cannot propagate are hidden, never guessed.
 */
export function SatelliteMarkers() {
  const visible = useSatelliteStore((s) => s.visible);
  const { propagator, markers } = useGlobeContext();
  const pixelRatio = useThree((s) => s.viewport.dpr);

  const geometry = useMemo(() => {
    const n = visible.length;
    const g = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage);
    const vis = new BufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage);
    const col = new Float32Array(n * 3);
    const c = new Color();
    visible.forEach((rec, i) => {
      c.set(CATEGORY_COLORS[rec.category]);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    });
    g.setAttribute('position', pos);
    g.setAttribute('aVisible', vis);
    g.setAttribute('color', new BufferAttribute(col, 3));
    return g;
  }, [visible]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uSize: { value: MARKER_SIZE_PX } },
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: false,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => {
    material.uniforms.uSize!.value = MARKER_SIZE_PX * pixelRatio;
  }, [material, pixelRatio]);

  // Hand the new set to the propagator and size the shared frame buffers.
  useEffect(() => {
    propagator.setSatellites(visible);
    markers.records = visible;
    markers.indexById = new Map(visible.map((r, i) => [r.noradId, i]));
    markers.positions = geometry.getAttribute('position').array as Float32Array;
    markers.valid = new Uint8Array(visible.length);
    return () => geometry.dispose();
  }, [visible, geometry, propagator, markers]);

  useFrame(() => {
    const simMs = getSimTimeMs();
    propagator.tick(simMs, performance.now(), useSettingsStore.getState().propagationHz);
    const snap = propagator.latest;
    const n = markers.records.length;
    const posAttr = geometry.getAttribute('position') as BufferAttribute;
    const visAttr = geometry.getAttribute('aVisible') as BufferAttribute;
    if (posAttr.count !== n) return;
    const pos = posAttr.array as Float32Array;
    const vis = visAttr.array as Float32Array;
    const dtS = snap ? (simMs - snap.timeMs) / 1000 : 0;
    // Hide everything rather than extrapolate far from the last SGP4 batch
    // (e.g. right after a time jump, until the next batch lands).
    const usable = snap !== null && snap.valid.length === n && Math.abs(dtS) <= MAX_EXTRAPOLATION_S;
    for (let i = 0; i < n; i++) {
      const ok = usable && snap.valid[i] === 1;
      markers.valid[i] = ok ? 1 : 0;
      vis[i] = ok ? 1 : 0;
      if (!ok) continue;
      extrapolateTwoBody(snap.positionsKm, snap.velocitiesKmS, i, dtS, tmpKm);
      writeSceneFromKm(tmpKm[0]!, tmpKm[1]!, tmpKm[2]!, pos, i * 3);
    }
    posAttr.needsUpdate = true;
    visAttr.needsUpdate = true;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
}
