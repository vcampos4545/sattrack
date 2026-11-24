import { X } from 'lucide-react';
import { CATALOG_GROUPS } from '../../services/celestrak';
import { useSatelliteStore } from '../../stores/satellite-store';
import { useSettingsStore } from '../../stores/settings-store';
import { formatDuration } from '../../utils/format';

const REFRESH_CHOICES_H = [2, 6, 12, 24, 72];

/**
 * Catalog and data settings. Visualization settings (orbit length, grid,
 * terminator, elevation mask) are added by the panels that use them.
 */
export function SettingsMenu({ onClose }: { onClose: () => void }) {
  const enabledGroups = useSatelliteStore((s) => s.enabledGroups);
  const groupStatus = useSatelliteStore((s) => s.groupStatus);
  const setGroupEnabled = useSatelliteStore((s) => s.setGroupEnabled);
  const autoRefreshHours = useSettingsStore((s) => s.autoRefreshHours);
  const update = useSettingsStore((s) => s.update);

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Catalog groups</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      <ul className="space-y-1">
        {CATALOG_GROUPS.map((g) => {
          const status = groupStatus.find((s) => s.groupId === g.id);
          const checked = enabledGroups.includes(g.id);
          return (
            <li key={g.id}>
              <label className="flex cursor-pointer items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setGroupEnabled(g.id, e.target.checked)}
                  className="accent-accent"
                />
                <span>{g.label}</span>
                {!g.defaultEnabled && <span className="text-[11px] text-warn">~{g.approxCount.toLocaleString()} objects</span>}
                <span className="ml-auto font-mono text-[11px] text-faint tabular">
                  {checked && status ? `${status.recordCount}${status.error ? ' · error' : ''}` : ''}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
        <label htmlFor="auto-refresh" className="text-muted">
          Auto-refresh after
        </label>
        <select
          id="auto-refresh"
          value={autoRefreshHours}
          onChange={(e) => update({ autoRefreshHours: Number(e.target.value) })}
          className="ml-auto border border-line bg-panel px-1 py-0.5 font-mono text-[12px]"
        >
          {(REFRESH_CHOICES_H.includes(autoRefreshHours) ? REFRESH_CHOICES_H : [...REFRESH_CHOICES_H, autoRefreshHours])
            .sort((a, b) => a - b)
            .map((h) => (
              <option key={h} value={h}>
                {formatDuration(h * 3_600_000)}
              </option>
            ))}
        </select>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        Data comes from CelesTrak, which updates about every 2 hours. Cached data is reused until it is older than this
        interval, and never re-downloaded more than once per 2 hours.
      </p>
    </div>
  );
}
