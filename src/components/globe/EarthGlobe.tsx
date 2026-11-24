import { Earth } from 'lucide-react';
import { useSatelliteStore } from '../../stores/satellite-store';
import { CATEGORY_LABELS, CATEGORY_PRIORITY } from '../../types/satellite';
import { CATEGORY_COLORS } from '../../utils/category-colors';
import { Panel, SlotEmptyState } from '../layout/Panel';

/**
 * Slot: primary 3D Earth globe (React Three Fiber). Owned by the globe task.
 *
 * Inputs it should use: `useSatelliteStore` (`visible`, `selectedId`,
 * `select`), `useSettingsStore` (orbit/grid/terminator toggles),
 * `getSimTimeMs()` in the frame loop, `propagateBatch` / `sampleTrajectory`
 * from core/orbit, and `CATEGORY_COLORS`.
 *
 * Until then it shows the loaded catalog composition, which is real data.
 */
export function EarthGlobe() {
  const visible = useSatelliteStore((s) => s.visible);
  const loadState = useSatelliteStore((s) => s.loadState);
  const counts = new Map<string, number>();
  for (const s of visible) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);

  return (
    <Panel title="Orbital view" icon={Earth} className="h-full">
      <SlotEmptyState summary="Interactive 3D globe with live satellite positions and orbit paths." phase="globe task">
        <div className="mt-4 font-mono text-[12px] text-muted tabular">
          {loadState === 'loading' && visible.length === 0 ? (
            'Loading catalog…'
          ) : (
            <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1">
              {CATEGORY_PRIORITY.filter((c) => counts.has(c)).map((c) => (
                <li key={c} className="flex items-center gap-1.5">
                  <span className="inline-block size-2" style={{ background: CATEGORY_COLORS[c] }} />
                  {CATEGORY_LABELS[c]} {counts.get(c)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SlotEmptyState>
    </Panel>
  );
}
