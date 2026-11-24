import { Stars } from '@react-three/drei';
import { Suspense, useMemo } from 'react';
import { Vector3 } from 'three';
import { useSettingsStore } from '../../stores/settings-store';
import { CameraRig } from './CameraRig';
import { Atmosphere, Earth, EarthFixedFrame, EarthPlaceholder } from './Earth';
import { createMarkerFrame, GlobeContext, type GlobeContextValue, type GlobeLabels } from './globe-context';
import { GlobePointer } from './GlobePointer';
import { LatLonGrid } from './LatLonGrid';
import { ObserverMarker } from './ObserverMarker';
import { OrbitPaths } from './OrbitPaths';
import type { BulkPropagator } from './propagation/bulk-propagator';
import { SatelliteMarkers } from './SatelliteMarkers';
import { SelectedSatellite } from './SelectedSatellite';

/**
 * Contents of the primary globe's canvas. The world frame is TEME (see
 * scene-frame.ts): satellites, orbits and the Sun are placed inertially and
 * the Earth-fixed group rotates by GMST beneath them.
 */
export function GlobeScene({ propagator, labels }: { propagator: BulkPropagator; labels: GlobeLabels }) {
  const showGrid = useSettingsStore((s) => s.showLatLonGrid);
  const ctx = useMemo<GlobeContextValue>(
    () => ({ propagator, labels, markers: createMarkerFrame(), selected: { position: new Vector3(), valid: false } }),
    [propagator, labels],
  );

  return (
    <GlobeContext.Provider value={ctx}>
      {/* Decorative backdrop, not a star catalog. */}
      <Stars radius={120} depth={60} count={4000} factor={3} saturation={0} fade speed={0} />
      <EarthFixedFrame>
        <Suspense fallback={<EarthPlaceholder />}>
          <Earth />
        </Suspense>
        {showGrid && <LatLonGrid />}
        <ObserverMarker />
      </EarthFixedFrame>
      <Atmosphere />
      <OrbitPaths />
      <SatelliteMarkers />
      <SelectedSatellite />
      <GlobePointer />
      <CameraRig />
    </GlobeContext.Provider>
  );
}
