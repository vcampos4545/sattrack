import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { DoubleSide, Quaternion, Vector3, type Group, type Mesh } from 'three';
import { observerEcef } from '../../core/orbit/observer';
import { DEG_TO_RAD } from '../../core/orbit/constants';
import { useObserverStore } from '../../stores/observer-store';
import { placeLabel, useGlobeContext } from './globe-context';
import { sceneFromKm } from './scene-frame';

export const OBSERVER_COLOR = '#ffffff';

const tmpWorld = new Vector3();
const tmpNormal = new Vector3();
const tmpToCamera = new Vector3();

/**
 * Observer (ground station) marker, Earth-fixed: place inside
 * `EarthFixedFrame`. Positioned at the observer's WGS84 ECEF position and
 * aligned with the ellipsoid normal (the observer's local "up"). Updates as
 * soon as the observer store changes.
 */
export function ObserverMarker() {
  const location = useObserverStore((s) => s.location);
  const group = useRef<Group>(null);
  const pulse = useRef<Mesh>(null);
  const { labels } = useGlobeContext();

  const { position, quaternion } = useMemo(() => {
    const lat = location.latitudeDeg * DEG_TO_RAD;
    const lon = location.longitudeDeg * DEG_TO_RAD;
    const normal = sceneFromKm({ x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) });
    const up = new Vector3(...normal).normalize();
    return {
      position: new Vector3(...sceneFromKm(observerEcef(location))),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), up),
    };
  }, [location]);

  useFrame(({ camera, clock, size }) => {
    if (pulse.current) {
      const t = (clock.elapsedTime % 2) / 2;
      pulse.current.scale.setScalar(1 + t * 2.2);
      (pulse.current.material as { opacity: number }).opacity = 0.7 * (1 - t);
    }
    // Hide the HTML label when the observer is on the far side of the Earth.
    if (group.current) {
      group.current.getWorldPosition(tmpWorld);
      tmpNormal.copy(tmpWorld).normalize();
      const facing = tmpNormal.dot(tmpToCamera.copy(camera.position).sub(tmpWorld)) > 0;
      placeLabel(labels.observer, tmpWorld, camera, size, facing);
    }
  });

  return (
    <group ref={group} position={position} quaternion={quaternion}>
      {/* Flat rings lie in the local horizontal plane (y is local up). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <ringGeometry args={[0.011, 0.015, 48]} />
        <meshBasicMaterial color={OBSERVER_COLOR} side={DoubleSide} transparent opacity={0.95} depthWrite={false} />
      </mesh>
      <mesh ref={pulse} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <ringGeometry args={[0.011, 0.013, 48]} />
        <meshBasicMaterial color={OBSERVER_COLOR} side={DoubleSide} transparent opacity={0.6} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.003, 0]}>
        <sphereGeometry args={[0.0045, 16, 8]} />
        <meshBasicMaterial color={OBSERVER_COLOR} />
      </mesh>
    </group>
  );
}
