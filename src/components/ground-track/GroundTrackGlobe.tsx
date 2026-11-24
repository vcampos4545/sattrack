import { Globe } from 'lucide-react';
import { Panel, SlotEmptyState } from '../layout/Panel';

/**
 * Slot: secondary 3D globe with the selected satellite's past/future ground
 * track, coverage footprint and the observer. Owned by the ground-track task.
 * Uses `sampleTrajectory` (geodetic samples) and
 * `useSettingsStore.footprintMinElevationDeg`.
 */
export function GroundTrackGlobe() {
  return (
    <Panel title="Ground track & footprint" icon={Globe} className="h-full">
      <SlotEmptyState
        summary="Past and predicted ground track, coverage footprint and observer visibility for the selected object."
        phase="Phase 3"
      />
    </Panel>
  );
}
