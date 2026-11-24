import { CalendarClock } from 'lucide-react';
import { Panel, SlotEmptyState } from '../layout/Panel';

/**
 * Slot: next passes of the selected satellite over the observer (AOS, LOS,
 * duration, max elevation, azimuths, direction). Owned by the passes task.
 * Produces `Pass` objects (types/passes.ts) and sets `selectedPassId`.
 */
export function UpcomingPasses() {
  return (
    <Panel title="Upcoming passes" icon={CalendarClock} className="h-full">
      <SlotEmptyState
        summary="Predicted passes for the selected object with AOS/LOS times, maximum elevation and a countdown."
        phase="Phase 4"
      />
    </Panel>
  );
}
