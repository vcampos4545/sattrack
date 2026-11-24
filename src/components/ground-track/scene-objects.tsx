import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AdditiveBlending, BackSide, Color, Group, Mesh, MeshBasicMaterial, Quaternion, ShaderMaterial, Vector3, type Texture } from 'three';
import type { ObserverLocation } from '../../types/observer';
import { loadLandTexture } from './land-texture';
import type { LiveSatellite } from './live-satellite';
import { geoToVector, GLOBE_RADIUS, GT_COLORS, LIFT } from './scene-geometry';

/** Earth-fixed globe with the Natural Earth land texture and a thin atmosphere rim. */
export function GlobeSurface() {
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let alive = true;
    loadLandTexture()
      .then((t) => alive && setTexture(t))
      .catch((err: unknown) => console.error('[ground-track] land texture failed to load', err));
    return () => {
      alive = false;
    };
  }, []);

  const rim = useMemo(
    () =>
      new ShaderMaterial({
        // Fresnel rim on the back faces of a slightly larger sphere: brightest
        // at the limb, transparent toward the center of the disc.
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            float f = pow(1.0 - abs(dot(vNormal, vView)), 3.0);
            gl_FragColor = vec4(0.30, 0.62, 1.0, f * 0.55);
          }`,
        side: BackSide,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  useEffect(() => () => rim.dispose(), [rim]);

  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 128, 64]} />
        {/* Keyed so the material is recreated (and its shader recompiled) once the map arrives. */}
        {texture ? <meshBasicMaterial key="map" map={texture} /> : <meshBasicMaterial key="plain" color="#08111f" />}
      </mesh>
      <mesh scale={1.06} material={rim}>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 32]} />
      </mesh>
    </group>
  );
}

const Y_UP = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const tmpNormal = new Vector3();

/** Orients a flat marker (drawn in its local XY plane) tangent to the globe at `pos`. */
function alignToSurface(obj: { quaternion: Quaternion }, pos: Vector3) {
  obj.quaternion.setFromUnitVectors(Z_AXIS, tmpNormal.copy(pos).normalize());
}

/** Current sub-satellite point: a bright dot with a halo ring, moved every frame. */
export function SubSatelliteMarker({ live, color }: { live: RefObject<LiveSatellite>; color: string }) {
  const group = useRef<Group>(null);
  const v = useMemo(() => new Vector3(), []);
  const pulse = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    const s = live.current.state;
    if (!g) return;
    g.visible = !!s;
    if (!s) return;
    geoToVector(s.geodetic.latitudeDeg, s.geodetic.longitudeDeg, LIFT.marker, v);
    g.position.copy(v);
    alignToSurface(g, v);
    if (pulse.current) {
      const t = (clock.elapsedTime % 1.6) / 1.6;
      pulse.current.scale.setScalar(1 + 1.8 * t);
      (pulse.current.material as MeshBasicMaterial).opacity = 0.7 * (1 - t);
    }
  });
  return (
    <group ref={group} visible={false}>
      <mesh renderOrder={11}>
        <circleGeometry args={[0.014, 24]} />
        <meshBasicMaterial color={GT_COLORS.subPoint} transparent />
      </mesh>
      <mesh>
        <ringGeometry args={[0.02, 0.026, 32]} />
        <meshBasicMaterial color={color} transparent />
      </mesh>
      <mesh ref={pulse}>
        <ringGeometry args={[0.02, 0.024, 32]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * Observer marker: a diamond with a ring. Turns green while the observer is
 * inside the footprint (sees the satellite above the minimum elevation).
 */
export function ObserverMarker({ observer, live }: { observer: ObserverLocation; live: RefObject<LiveSatellite> }) {
  const group = useRef<Group>(null);
  const position = useMemo(() => geoToVector(observer.latitudeDeg, observer.longitudeDeg, LIFT.marker), [observer]);
  const materials = useMemo(
    // Rendered after the track (renderOrder) and lifted above it, so the
    // station stays on top of lines while the globe still hides its far side.
    () => [
      new MeshBasicMaterial({ color: GT_COLORS.observer, transparent: true }),
      new MeshBasicMaterial({ color: GT_COLORS.observer, transparent: true, opacity: 0.85 }),
    ],
    [],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  useEffect(() => {
    if (group.current) {
      group.current.position.copy(position);
      alignToSurface(group.current, position);
    }
  }, [position]);
  const wasInside = useRef<boolean | null>(null);
  useFrame(() => {
    const inside = live.current.observerInside;
    if (inside === wasInside.current) return;
    wasInside.current = inside;
    const c = new Color(inside ? GT_COLORS.observerVisible : GT_COLORS.observer);
    for (const m of materials) m.color.copy(c);
  });
  return (
    <group ref={group} renderOrder={10}>
      <mesh rotation={[0, 0, Math.PI / 4]} material={materials[0]} renderOrder={10}>
        <planeGeometry args={[0.024, 0.024]} />
      </mesh>
      <mesh material={materials[1]} renderOrder={10}>
        <ringGeometry args={[0.032, 0.039, 4, 1, Math.PI / 4]} />
      </mesh>
    </group>
  );
}

/**
 * Keeps the camera over the sub-satellite point while `enabled`, easing
 * toward it so the view does not jump when the selection changes. Distance
 * (zoom) is left to the user.
 */
export function CameraFollow({ live, enabled }: { live: RefObject<LiveSatellite>; enabled: boolean }) {
  const camera = useThree((s) => s.camera);
  const target = useMemo(() => new Vector3(), []);
  const dir = useMemo(() => new Vector3(), []);
  useFrame((_, delta) => {
    const s = live.current.state;
    if (!enabled || !s) return;
    geoToVector(s.geodetic.latitudeDeg, s.geodetic.longitudeDeg, 1, target);
    const dist = camera.position.length();
    dir.copy(camera.position).normalize();
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 2.5);
    dir.lerp(target, k).normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.up.copy(Y_UP);
    camera.lookAt(0, 0, 0);
  });
  return null;
}
