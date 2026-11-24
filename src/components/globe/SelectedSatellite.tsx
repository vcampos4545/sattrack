import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Color, Quaternion, ShaderMaterial, Vector3, type Group } from 'three';
import { propagateToTime, satrecFor, type SatRec } from '../../core/orbit/sgp4';
import { selectSelectedSatellite, useSatelliteStore } from '../../stores/satellite-store';
import { getSimTimeMs } from '../../stores/time-store';
import { CATEGORY_COLORS } from '../../utils/category-colors';
import { useGlobeContext } from './globe-context';
import { writeSceneFromKm } from './scene-frame';

/** Length of the velocity-direction arrow, scene units (Earth radii). */
const ARROW_LENGTH = 0.22;

const ringVertex = /* glsl */ `
  uniform float uSize;
  void main() {
    gl_PointSize = uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ringFragment = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float ring = smoothstep(0.30, 0.34, d) * (1.0 - smoothstep(0.42, 0.46, d));
    float core = 1.0 - smoothstep(0.12, 0.16, d);
    float a = max(ring, core);
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.6), a);
    #include <colorspace_fragment>
  }
`;

const tmpPos = new Float64Array(3);
const tmpVel = new Float64Array(3);
const up = new Vector3(0, 1, 0);
const dir = new Vector3();
const q = new Quaternion();

/**
 * Highlight for the selected object: a ring marker at its exact SGP4 position
 * (evaluated every frame, one object is cheap) and an arrow along its
 * inertial velocity, so the direction of travel is visible. Drawn even when
 * the object's category is filtered out, since the user selected it.
 */
export function SelectedSatellite() {
  const record = useSatelliteStore(selectSelectedSatellite);
  const { selected } = useGlobeContext();
  const group = useRef<Group>(null);
  const arrow = useRef<Group>(null);

  // The shared position belongs to the previous selection until the next frame.
  useEffect(() => {
    selected.valid = false;
  }, [record, selected]);

  const satrec = useMemo((): SatRec | null => {
    if (!record) return null;
    try {
      return satrecFor(record.tle);
    } catch {
      return null;
    }
  }, [record]);

  const color = record ? CATEGORY_COLORS[record.category] : '#ffffff';
  const ring = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    const m = new ShaderMaterial({
      uniforms: { uSize: { value: 26 * Math.min(window.devicePixelRatio, 2) }, uColor: { value: new Color(color) } },
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      transparent: true,
      depthWrite: false,
    });
    return { g, m };
  }, [color]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const result = satrec ? propagateToTime(satrec, getSimTimeMs()) : null;
    if (!result?.ok) {
      g.visible = false;
      selected.valid = false;
      return;
    }
    const { positionKm: p, velocityKmS: v } = result.state;
    writeSceneFromKm(p.x, p.y, p.z, tmpPos);
    writeSceneFromKm(v.x, v.y, v.z, tmpVel);
    g.position.set(tmpPos[0]!, tmpPos[1]!, tmpPos[2]!);
    g.visible = true;
    selected.position.copy(g.position);
    selected.valid = true;
    if (arrow.current) {
      dir.set(tmpVel[0]!, tmpVel[1]!, tmpVel[2]!).normalize();
      arrow.current.quaternion.copy(q.setFromUnitVectors(up, dir));
    }
  });

  if (!record) return null;
  return (
    <group ref={group} visible={false}>
      <points geometry={ring.g} material={ring.m} frustumCulled={false} renderOrder={5} />
      <group ref={arrow}>
        <mesh position={[0, ARROW_LENGTH / 2, 0]} renderOrder={4}>
          <cylinderGeometry args={[0.0022, 0.0022, ARROW_LENGTH, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <mesh position={[0, ARROW_LENGTH, 0]} renderOrder={4}>
          <coneGeometry args={[0.012, 0.035, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    </group>
  );
}
