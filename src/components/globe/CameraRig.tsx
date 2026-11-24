import { OrbitControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef, type ComponentRef } from 'react';
import { Vector3 } from 'three';
import { observerEcef } from '../../core/orbit/observer';
import { gmstRad } from '../../core/orbit/time-utils';
import { useObserverStore } from '../../stores/observer-store';
import { getSimTimeMs } from '../../stores/time-store';
import { useGlobeContext } from './globe-context';
import { useGlobeViewStore } from './globe-view-store';
import { rotateSceneY, sceneFromKm } from './scene-frame';

/** Camera distance limits, Earth radii from the center (GEO is at 6.6). */
export const MIN_DISTANCE = 1.25;
export const MAX_DISTANCE = 14;
const INITIAL_DISTANCE = 3.4;
const FOCUS_DURATION_S = 0.9;

const from = new Vector3();
const to = new Vector3();
const tmp = new Vector3();

/** Observer direction in the (inertial) scene frame at the current simulation time. */
function observerSceneDirection(out: Vector3): Vector3 {
  const ecef = sceneFromKm(observerEcef(useObserverStore.getState().location));
  const world = rotateSceneY(ecef, gmstRad(getSimTimeMs()));
  return out.set(world[0], world[1], world[2]).normalize();
}

/**
 * Orbit controls (drag to rotate, scroll to zoom, no pan so the Earth stays
 * centered) plus animated focus on the observer or the selected object.
 * The camera starts above the observer.
 */
export function CameraRig() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { selected } = useGlobeContext();
  const anim = useRef<{ t: number; fromDist: number; toDist: number } | null>(null);
  const handledSeq = useRef(0);
  const initialized = useRef(false);
  const waitFrames = useRef(0);

  useFrame(({ camera }, delta) => {
    if (!initialized.current) {
      initialized.current = true;
      camera.position.copy(observerSceneDirection(tmp).multiplyScalar(INITIAL_DISTANCE));
      camera.lookAt(0, 0, 0);
      controls.current?.update();
    }

    // A focus request on the selected object waits (up to ~1 s) until its
    // position has been computed, e.g. right after selecting from search.
    const focus = useGlobeViewStore.getState().focus;
    if (focus && focus.seq !== handledSeq.current) {
      const waitingForSelection = focus.target === 'selected' && !selected.valid;
      if (waitingForSelection && ++waitFrames.current < 60) return;
      handledSeq.current = focus.seq;
      waitFrames.current = 0;
      const dist = camera.position.length();
      if (focus.target === 'observer') {
        observerSceneDirection(to);
        anim.current = { t: 0, fromDist: dist, toDist: Math.max(dist, 2.2) };
      } else if (selected.valid) {
        to.copy(selected.position).normalize();
        const r = selected.position.length();
        anim.current = { t: 0, fromDist: dist, toDist: Math.min(MAX_DISTANCE, Math.max(dist, r + 1.6)) };
      }
      from.copy(camera.position).normalize();
    }

    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + delta / FOCUS_DURATION_S);
      const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - (-2 * a.t + 2) ** 2 / 2; // ease in-out
      // Spherical interpolation of the view direction, linear in distance.
      const angle = from.angleTo(to);
      if (angle > 1e-6) {
        tmp.crossVectors(from, to).normalize();
        if (tmp.lengthSq() < 0.5) tmp.set(0, 1, 0); // antipodal: any perpendicular axis
        camera.position.copy(from).applyAxisAngle(tmp, angle * e);
      } else {
        camera.position.copy(from);
      }
      camera.position.multiplyScalar(a.fromDist + (a.toDist - a.fromDist) * e);
      camera.lookAt(0, 0, 0);
      controls.current?.update();
      if (a.t >= 1) anim.current = null;
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.5}
      zoomSpeed={0.7}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
    />
  );
}
