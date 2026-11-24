import { EarthGlobe } from '../globe/EarthGlobe';
import { GroundTrackGlobe } from '../ground-track/GroundTrackGlobe';
import { UpcomingPasses } from '../passes/UpcomingPasses';
import { SatelliteInfo } from '../satellite/SatelliteInfo';
import { SkyPlot } from '../sky-plot/SkyPlot';

/**
 * Dashboard grid (spec section 2). Each panel is a self-contained slot
 * component in its own file, so features can be built in parallel without
 * touching this layout.
 */
export function Dashboard() {
  return (
    <main className="grid flex-1 grid-cols-1 gap-px bg-line p-px lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="h-[62vh] min-h-[420px] lg:col-span-2">
        <EarthGlobe />
      </div>
      <div className="lg:col-span-2">
        <SatelliteInfo />
      </div>
      <div className="h-[380px]">
        <GroundTrackGlobe />
      </div>
      <div className="h-[380px]">
        <SkyPlot />
      </div>
      <div className="min-h-[220px] lg:col-span-2">
        <UpcomingPasses />
      </div>
    </main>
  );
}
