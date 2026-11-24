import { Radar } from 'lucide-react';
import { Panel, SlotEmptyState } from '../layout/Panel';

/**
 * Slot: azimuth/elevation polar plot (north up, east right, zenith center).
 * Owned by the sky-plot task. Uses `lookAnglesAt` / `computeLookAngles`, the
 * shared `Pass.track` samples and `selectedPassId`. Should accept optional
 * antenna az/el inputs later (commanded vs. actual pointing).
 */
export function SkyPlot() {
  return (
    <Panel title="Local sky" icon={Radar} className="h-full">
      <SlotEmptyState
        summary="Azimuth/elevation plot of the selected object's path across your sky, with the selected pass marked."
        phase="Phase 5"
      />
    </Panel>
  );
}
