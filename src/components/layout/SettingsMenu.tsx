import { RefreshCw, RotateCcw, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useCatalogHealth } from '../../hooks/use-catalog-health';
import { CATALOG_GROUPS } from '../../services/celestrak';
import { useSatelliteStore } from '../../stores/satellite-store';
import { DEFAULT_SETTINGS, useSettingsStore, type OrbitScope, type Settings } from '../../stores/settings-store';
import { formatDuration, formatLocal } from '../../utils/format';

const REFRESH_CHOICES_H = [2, 6, 12, 24, 72];
const COUNT_CHOICES = [5, 10, 15, 20];
const DAY_CHOICES = [1, 3, 7, 14];
const STEP_CHOICES = [10, 30, 60, 120];
const ORBIT_LENGTH_CHOICES = [0.25, 0.5, 1, 2, 3, 5];
const AHEAD_CHOICES = [1, 2, 3];
const HZ_CHOICES = [0.5, 1, 2, 5, 10];

/** Choice list that always contains the current value (it may come from an older stored copy). */
const withCurrent = (list: number[], current: number) => [...new Set([...list, current])].sort((a, b) => a - b);

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-line px-3 py-2.5 first:border-t-0">
      <div className="mb-1.5 flex items-center">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">{title}</h3>
        <div className="ml-auto">{aside}</div>
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2" title={hint}>
      <label htmlFor={htmlFor} className="text-muted">
        {label}
      </label>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );
}

const controlClass = 'border border-line bg-panel px-1 py-0.5 font-mono text-[12px] tabular disabled:opacity-40';

function SelectSetting({
  id,
  value,
  choices,
  format,
  onPick,
  disabled,
}: {
  id: string;
  value: number;
  choices: number[];
  format: (v: number) => string;
  onPick: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onPick(Number(e.target.value))} className={controlClass}>
      {withCurrent(choices, value).map((v) => (
        <option key={v} value={v}>
          {format(v)}
        </option>
      ))}
    </select>
  );
}

/** Number input that commits on blur or Enter, so typing "15" never applies "1" first. */
function DegreesSetting({ id, value, onCommit, max = 89 }: { id: string; value: number; onCommit: (v: number) => void; max?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(v)) onCommit(v);
    else setDraft(String(value));
  };
  return (
    <>
      <input
        id={id}
        type="number"
        min={0}
        max={max}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={`w-14 text-right ${controlClass}`}
      />
      <span className="text-faint">°</span>
    </>
  );
}

function Check({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />;
}

/**
 * Settings drawer: every persisted setting in one place, grouped by what it
 * affects, plus catalog groups, data refresh and added or removed catalog objects.
 * The same values are also editable inline on the panels that use them; both
 * write to the settings store, so they always agree.
 */
export function SettingsMenu({ onClose }: { onClose: () => void }) {
  const s = useSettingsStore();
  const update = (patch: Partial<Settings>) => s.update(patch);
  const [confirmReset, setConfirmReset] = useState(false);
  const isDefault = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).every((k) => s[k] === DEFAULT_SETTINGS[k]);

  return (
    <div className="text-[12px]" data-testid="settings-panel">
      <div className="flex items-center border-b border-line px-3 py-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Settings</h2>
        <button type="button" onClick={onClose} aria-label="Close settings" className="ml-auto text-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>

      <Section title="Passes and sky plot">
        <Row label="Elevation mask" htmlFor="set-mask" hint="Minimum elevation for AOS/LOS; also drawn on the sky plot">
          <DegreesSetting id="set-mask" value={s.elevationMaskDeg} onCommit={(v) => update({ elevationMaskDeg: v })} />
        </Row>
        <Row label="Passes to predict" htmlFor="set-count">
          <SelectSetting id="set-count" value={s.passCount} choices={COUNT_CHOICES} format={String} onPick={(v) => update({ passCount: v })} />
        </Row>
        <Row label="Search window" htmlFor="set-days">
          <SelectSetting id="set-days" value={s.passSearchDays} choices={DAY_CHOICES} format={(v) => `${v} d`} onPick={(v) => update({ passSearchDays: v })} />
        </Row>
        <Row label="Coarse scan step" htmlFor="set-step" hint="Sampling step before AOS/LOS bisection and max-elevation refinement">
          <SelectSetting id="set-step" value={s.passScanStepS} choices={STEP_CHOICES} format={(v) => `${v} s`} onPick={(v) => update({ passScanStepS: v })} />
        </Row>
      </Section>

      <Section title="Ground track and footprint">
        <Row label="Footprint min elevation" htmlFor="set-fp" hint="Ground elevation angle that bounds the coverage footprint; 0 = geometric horizon">
          <DegreesSetting id="set-fp" value={s.footprintMinElevationDeg} onCommit={(v) => update({ footprintMinElevationDeg: v })} />
        </Row>
        <Row label="Predicted track" htmlFor="set-ahead">
          <SelectSetting
            id="set-ahead"
            value={s.groundTrackAheadRevs}
            choices={AHEAD_CHOICES}
            format={(v) => `${v} rev`}
            onPick={(v) => update({ groundTrackAheadRevs: v })}
          />
        </Row>
      </Section>

      <Section title="Globe">
        <Row label="Orbit paths" htmlFor="set-orbits">
          <Check id="set-orbits" checked={s.showOrbits} onChange={(v) => update({ showOrbits: v })} />
        </Row>
        <Row label="Draw orbits for" htmlFor="set-scope">
          <select
            id="set-scope"
            value={s.orbitScope}
            disabled={!s.showOrbits}
            onChange={(e) => update({ orbitScope: e.target.value as OrbitScope })}
            className={controlClass}
          >
            <option value="selected">Selected object</option>
            <option value="all">All visible</option>
          </select>
        </Row>
        <Row label="Orbit length" htmlFor="set-orbit-len">
          <SelectSetting
            id="set-orbit-len"
            value={s.orbitLengthPeriods}
            choices={ORBIT_LENGTH_CHOICES}
            format={(v) => `${v} rev`}
            disabled={!s.showOrbits}
            onPick={(v) => update({ orbitLengthPeriods: v })}
          />
        </Row>
        <Row label="Latitude/longitude grid" htmlFor="set-grid">
          <Check id="set-grid" checked={s.showLatLonGrid} onChange={(v) => update({ showLatLonGrid: v })} />
        </Row>
        <Row label="Day/night terminator" htmlFor="set-term">
          <Check id="set-term" checked={s.showTerminator} onChange={(v) => update({ showTerminator: v })} />
        </Row>
      </Section>

      <Section title="Performance">
        <Row
          label="SGP4 update rate"
          htmlFor="set-hz"
          hint="How often all visible objects are re-propagated. Rendering stays at the display frame rate; markers are extrapolated in between."
        >
          <SelectSetting id="set-hz" value={s.propagationHz} choices={HZ_CHOICES} format={(v) => `${v} Hz`} onPick={(v) => update({ propagationHz: v })} />
        </Row>
      </Section>

      <DataSection autoRefreshHours={s.autoRefreshHours} onAutoRefresh={(h) => update({ autoRefreshHours: h })} />
      <CatalogObjectsSection />

      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <p className="text-[11px] text-faint">Settings are saved in this browser.</p>
        <button
          type="button"
          disabled={isDefault && !confirmReset}
          onClick={() => {
            if (!confirmReset) return setConfirmReset(true);
            s.reset();
            setConfirmReset(false);
          }}
          onBlur={() => setConfirmReset(false)}
          className={`ml-auto flex items-center gap-1 border px-2 py-0.5 font-mono text-[11px] disabled:opacity-40 ${confirmReset ? 'border-warn text-warn' : 'border-line-strong hover:border-accent'}`}
        >
          <RotateCcw className="size-3" aria-hidden />
          {confirmReset ? 'Confirm reset' : 'Reset to defaults'}
        </button>
      </div>
    </div>
  );
}

function DataSection({ autoRefreshHours, onAutoRefresh }: { autoRefreshHours: number; onAutoRefresh: (h: number) => void }) {
  const enabledGroups = useSatelliteStore((s) => s.enabledGroups);
  const groupStatus = useSatelliteStore((s) => s.groupStatus);
  const setGroupEnabled = useSatelliteStore((s) => s.setGroupEnabled);
  const loadCatalog = useSatelliteStore((s) => s.loadCatalog);
  const loading = useSatelliteStore((s) => s.loadState === 'loading');
  const health = useCatalogHealth();

  return (
    <Section
      title="Orbital data (CelesTrak)"
      aside={
        <button
          type="button"
          onClick={() => void loadCatalog({ force: true })}
          disabled={loading}
          className="flex items-center gap-1 border border-line-strong px-2 py-0.5 font-mono text-[11px] hover:border-accent disabled:opacity-50"
        >
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Refresh now
        </button>
      }
    >
      <div className="font-mono text-[11px] text-muted tabular">
        {health.oldestFetchMs !== null ? (
          <>
            Last updated {formatLocal(health.oldestFetchMs)}
            <span className="text-faint"> ({formatDuration(health.dataAgeMs ?? 0)} ago)</span>
          </>
        ) : (
          'Not downloaded yet'
        )}
      </div>
      <div className="font-mono text-[11px] text-faint tabular" title="Epoch age relative to the displayed (simulation) time">
        Epochs: <span className="text-ok">{health.epochCounts.fresh} fresh</span> ·{' '}
        <span className={health.epochCounts.aging ? 'text-warn' : ''}>{health.epochCounts.aging} aging</span> ·{' '}
        <span className={health.epochCounts.stale ? 'text-danger' : ''}>{health.epochCounts.stale} stale</span>
        {health.rejectedCount > 0 && <> · {health.rejectedCount} rejected</>}
      </div>
      <ul className="space-y-0.5 pt-1">
        {CATALOG_GROUPS.map((g) => {
          const status = groupStatus.find((st) => st.groupId === g.id);
          const checked = enabledGroups.includes(g.id);
          return (
            <li key={g.id}>
              <label className="flex cursor-pointer items-center gap-2 py-0.5" title={status?.error ?? undefined}>
                <input type="checkbox" checked={checked} onChange={(e) => setGroupEnabled(g.id, e.target.checked)} className="accent-accent" />
                <span>{g.label}</span>
                {!g.defaultEnabled && <span className="text-[11px] text-warn">~{g.approxCount.toLocaleString()} objects</span>}
                <span className={`ml-auto font-mono text-[11px] tabular ${status?.error ? 'text-warn' : 'text-faint'}`}>
                  {checked && status
                    ? `${status.recordCount}${status.error ? (status.source === 'cache' ? ' · cached' : ' · failed') : ''}`
                    : ''}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <Row label="Auto-refresh after" htmlFor="auto-refresh">
        <SelectSetting id="auto-refresh" value={autoRefreshHours} choices={REFRESH_CHOICES_H} format={(h) => formatDuration(h * 3_600_000)} onPick={onAutoRefresh} />
      </Row>
      <p className="text-[11px] leading-relaxed text-faint">
        CelesTrak updates about every 2 hours. Cached data is reused until it is older than this interval and is never
        re-downloaded more than once per 2 hours. Offline, the cached copy is used and flagged.
      </p>
    </Section>
  );
}

function CatalogObjectsSection() {
  const removedCount = useSatelliteStore((s) => s.removedIds.length);
  const extraNoradIds = useSatelliteStore((s) => s.extraNoradIds);
  const extraStatus = useSatelliteStore((s) => s.extraStatus);
  const byId = useSatelliteStore((s) => s.byId);
  const restoreRemoved = useSatelliteStore((s) => s.restoreRemoved);
  const removeObject = useSatelliteStore((s) => s.removeObject);
  if (removedCount === 0 && extraNoradIds.length === 0) return null;
  return (
    <Section title="Catalog objects">
      {removedCount > 0 && (
        <Row label={`${removedCount} object${removedCount === 1 ? '' : 's'} removed from groups`}>
          <button type="button" onClick={restoreRemoved} className="border border-line-strong px-2 py-0.5 font-mono text-[11px] hover:border-accent">
            Restore all
          </button>
        </Row>
      )}
      {extraNoradIds.map((id) => {
        const err = extraStatus.find((e) => e.noradId === id)?.error;
        return (
          <Row key={id} label={`${byId.get(id)?.name ?? 'NORAD'} · ${id}`} hint={err ?? 'Added individually by NORAD id'}>
            {err && <span className="font-mono text-[11px] text-warn">error</span>}
            <button type="button" onClick={() => removeObject(id)} aria-label={`Remove ${id}`} className="text-muted hover:text-ink">
              <X className="size-3.5" />
            </button>
          </Row>
        );
      })}
    </Section>
  );
}
