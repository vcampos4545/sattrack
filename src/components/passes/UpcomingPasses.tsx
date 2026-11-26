import { CalendarClock, LoaderCircle, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { currentOrNextPass, isPassInProgress, passDirection, type PassSearchResult } from '../../core/orbit/pass-prediction';
import { useLiveLookAngles } from '../../hooks/use-live-look-angles';
import { useSimTimeMs } from '../../hooks/use-sim-time';
import { usePassPredictions } from '../../hooks/use-pass-predictions';
import { useObserverStore } from '../../stores/observer-store';
import { findPass } from '../../stores/pass-store';
import { selectSelectedSatellite, useSatelliteStore } from '../../stores/satellite-store';
import { useSettingsStore } from '../../stores/settings-store';
import type { ObserverLocation } from '../../types/observer';
import type { LookAngles } from '../../types/orbital';
import type { Pass } from '../../types/passes';
import type { SatelliteRecord } from '../../types/satellite';
import { CATEGORY_COLORS } from '../../utils/category-colors';
import { formatDuration, formatLatitude, formatLongitude } from '../../utils/format';
import { Panel } from '../layout/Panel';
import { TrackedOnlyToggle } from '../satellite/TrackedList';
import { PassDetails } from './PassDetails';
import {
  formatAzimuth,
  formatCountdown,
  formatLocalDay,
  formatLocalTime,
  formatPassDuration,
  localZoneName,
} from './pass-format';

function observerLabel(loc: ObserverLocation): string {
  return loc.label ?? `${formatLatitude(loc.latitudeDeg, 2)} ${formatLongitude(loc.longitudeDeg, 2)}`;
}

/** Elevation mask input. Commits on blur/Enter so typing "15" does not search at 1 first. */
function MaskControl() {
  const mask = useSettingsStore((s) => s.elevationMaskDeg);
  const update = useSettingsStore((s) => s.update);
  const [draft, setDraft] = useState(String(mask));
  useEffect(() => setDraft(String(mask)), [mask]);
  const commit = () => {
    const v = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(v)) update({ elevationMaskDeg: v });
    else setDraft(String(mask));
  };
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted" title="Minimum elevation for AOS/LOS (also the sky-plot mask)">
      Mask
      <input
        id="pass-elevation-mask"
        name="elevationMaskDeg"
        type="number"
        min={0}
        max={89}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="w-11 border border-line bg-base px-1 py-0.5 text-right font-mono text-[11px] text-ink tabular"
        aria-label="Elevation mask in degrees"
      />
      °
    </label>
  );
}

const COUNT_CHOICES = [5, 10, 15, 20];
const DAY_CHOICES = [1, 3, 7, 14];
const STEP_CHOICES = [10, 30, 60, 120];

function SearchSettings() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const passCount = useSettingsStore((s) => s.passCount);
  const passSearchDays = useSettingsStore((s) => s.passSearchDays);
  const passScanStepS = useSettingsStore((s) => s.passScanStepS);
  const update = useSettingsStore((s) => s.update);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choices = (list: number[], current: number) => [...new Set([...list, current])].sort((a, b) => a - b);
  const select = (id: string, label: string, value: number, list: number[], unit: string, onPick: (v: number) => void) => (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onPick(Number(e.target.value))}
        className="ml-auto border border-line bg-panel px-1 py-0.5 font-mono text-[12px]"
      >
        {choices(list, value).map((v) => (
          <option key={v} value={v}>
            {v} {unit}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Pass search settings"
        className={`border p-1 hover:border-line-strong ${open ? 'border-line-strong bg-panel-raised' : 'border-line'}`}
      >
        <SlidersHorizontal className="size-3 text-muted" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full z-30 mb-1 w-[240px] space-y-2 border border-line-strong bg-panel-raised p-3 shadow-2xl shadow-black/50">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Pass search</h3>
          {select('pass-count', 'Passes', passCount, COUNT_CHOICES, '', (v) => update({ passCount: v }))}
          {select('pass-days', 'Look ahead', passSearchDays, DAY_CHOICES, 'd', (v) => update({ passSearchDays: v }))}
          {select('pass-step', 'Scan step', passScanStepS, STEP_CHOICES, 's', (v) => update({ passScanStepS: v }))}
          <p className="text-[11px] leading-relaxed text-faint">
            Elevation is sampled every scan step, then AOS and LOS are bisected to 10 ms and the peak is refined by
            golden-section search. Short grazing passes between samples are still caught.
          </p>
        </div>
      )}
    </div>
  );
}

/** Live visibility of the selected satellite relative to the horizon and mask. */
function VisibilityIndicator({ look, mask }: { look: LookAngles | null; mask: number }) {
  if (!look) return <span className="text-faint">No position</span>;
  const above = look.elevationDeg >= mask;
  const overHorizon = look.elevationDeg >= 0;
  const color = above ? 'bg-ok' : overHorizon ? 'bg-warn' : 'bg-faint';
  const text = above ? 'Visible' : overHorizon ? 'Below mask' : 'Below horizon';
  return (
    <span className="flex items-center gap-2">
      <span className={`inline-block size-2 rounded-full ${color} ${above ? 'animate-pulse' : ''}`} aria-hidden />
      <span className={above ? 'text-ok' : 'text-muted'}>{text}</span>
      <span className="font-mono text-[11px] text-muted tabular">
        az {formatAzimuth(look.azimuthDeg)} el {look.elevationDeg.toFixed(1)}° · {Math.round(look.rangeKm).toLocaleString()} km
      </span>
    </span>
  );
}

function elevationClass(el: number): string {
  if (el >= 60) return 'text-accent';
  if (el >= 30) return 'text-ink';
  return 'text-muted';
}

function PassRow({
  pass,
  index,
  nowMs,
  selected,
  onToggle,
  satellite,
}: {
  pass: Pass;
  index: number;
  nowMs: number;
  selected: boolean;
  onToggle: () => void;
  /** Shown in a Satellite column (combined Tracked-list schedule). `undefined` hides the column. */
  satellite?: SatelliteRecord | null;
}) {
  const live = isPassInProgress(pass, nowMs);
  const dir = passDirection(pass);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };
  return (
    <tr
      onClick={onToggle}
      onKeyDown={onKey}
      tabIndex={0}
      aria-selected={selected}
      className={`cursor-pointer border-t border-line outline-none hover:bg-panel-raised focus-visible:bg-panel-raised ${
        selected ? 'bg-panel-raised shadow-[inset_2px_0_0_var(--color-accent)]' : ''
      }`}
    >
      <td className="py-1.5 pr-3 pl-3 text-faint">{index + 1}</td>
      {satellite !== undefined && (
        <td className="max-w-[220px] py-1.5 pr-3" data-testid="pass-satellite">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className="inline-block size-2 shrink-0"
              style={{ background: satellite ? CATEGORY_COLORS[satellite.category] : 'transparent' }}
              aria-hidden
            />
            <span className="truncate" title={satellite ? `${satellite.name} · NORAD ${satellite.noradId}` : undefined}>
              {satellite?.name ?? `NORAD ${pass.noradId}`}
            </span>
          </span>
        </td>
      )}
      <td className="py-1.5 pr-3 font-sans text-muted">{formatLocalDay(pass.aosMs)}</td>
      <td className="py-1.5 pr-3">{formatLocalTime(pass.aosMs)}</td>
      <td className="py-1.5 pr-3">{formatLocalTime(pass.losMs)}</td>
      <td className="py-1.5 pr-3 text-right">{formatPassDuration(pass.durationS)}</td>
      <td className={`py-1.5 pr-3 text-right ${elevationClass(pass.maxElevationDeg)}`}>{pass.maxElevationDeg.toFixed(1)}°</td>
      <td className="py-1.5 pr-3 text-right">{formatAzimuth(pass.aosAzimuthDeg)}</td>
      <td className="py-1.5 pr-3 text-right">{formatAzimuth(pass.losAzimuthDeg)}</td>
      <td className="py-1.5 pr-3" title={dir.heading}>
        {dir.from} → {dir.to}
      </td>
      <td className="py-1.5 pr-3 text-right">
        {live ? (
          <span className="text-ok">LIVE · LOS {formatCountdown(pass.losMs - nowMs)}</span>
        ) : (
          <span className="text-muted">in {formatCountdown(pass.aosMs - nowMs)}</span>
        )}
      </td>
    </tr>
  );
}

function PassTable({
  passes,
  zone,
  nowMs,
  selectedPassId,
  onToggle,
  satellites,
}: {
  passes: readonly Pass[];
  zone: string;
  nowMs: number;
  selectedPassId: string | null;
  onToggle: (pass: Pass) => void;
  /** Adds the Satellite column, resolving names from this map. */
  satellites?: ReadonlyMap<number, SatelliteRecord>;
}) {
  return (
    <table className="w-full font-mono text-[12px] tabular whitespace-nowrap">
      <thead className="sticky top-0 bg-panel">
        <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-faint">
          <th className="py-1.5 pr-3 pl-3 font-normal">#</th>
          {satellites && <th className="py-1.5 pr-3 font-normal">Satellite</th>}
          <th className="py-1.5 pr-3 font-normal">Date</th>
          <th className="py-1.5 pr-3 font-normal">AOS ({zone})</th>
          <th className="py-1.5 pr-3 font-normal">LOS ({zone})</th>
          <th className="py-1.5 pr-3 text-right font-normal">Duration</th>
          <th className="py-1.5 pr-3 text-right font-normal">Max El</th>
          <th className="py-1.5 pr-3 text-right font-normal">AOS Az</th>
          <th className="py-1.5 pr-3 text-right font-normal">LOS Az</th>
          <th className="py-1.5 pr-3 font-normal">Direction</th>
          <th className="py-1.5 pr-3 text-right font-normal">Countdown</th>
        </tr>
      </thead>
      <tbody>
        {passes.map((p, i) => (
          <PassRow
            key={p.id}
            pass={p}
            index={i}
            nowMs={nowMs}
            selected={p.id === selectedPassId}
            onToggle={() => onToggle(p)}
            satellite={satellites ? (satellites.get(p.noradId) ?? null) : undefined}
          />
        ))}
      </tbody>
    </table>
  );
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center px-6 py-8 text-center text-muted">{children}</div>;
}

function resultMessage(result: PassSearchResult, observer: string): string | null {
  const mask = `${result.elevationMaskDeg}°`;
  const days = Math.round((result.windowEndMs - result.searchStartMs) / 86_400_000);
  switch (result.status) {
    case 'never-above-mask':
      return `Does not rise above ${mask} from ${observer} in the next ${days} d. Highest sampled elevation ${result.highestSampledElevationDeg.toFixed(1)}°.`;
    case 'always-above-mask':
      return `Stays above ${mask} from ${observer} for the whole search (typical of a geostationary satellite), so there is no rise or set to predict.`;
    case 'propagation-error':
      return `SGP4 cannot propagate this element set at the simulation time: ${result.error ?? 'unknown error'}.`;
    default:
      return null;
  }
}

/**
 * Upcoming passes over the observer (spec section 6). Predictions come from
 * `core/orbit/pass-prediction.ts`, run in Web Workers by
 * `services/pass-scheduler.ts` and shared through the pass store. Times
 * display in local time; everything is UTC internally.
 *
 * With "Tracked only" off this lists the selected satellite's passes, and
 * clicking a row sets `selectedPassId`, which the sky plot highlights. With
 * it on, see `TrackedPasses`.
 */
export function UpcomingPasses() {
  const mode = usePassPredictions().mode;
  return mode === 'tracked' ? <TrackedPasses /> : <SelectedPasses />;
}

function SelectedPasses() {
  const { state, result, passes, refreshing, error } = usePassPredictions();
  const record = useSatelliteStore(selectSelectedSatellite);
  const selectedPassId = useSatelliteStore((s) => s.selectedPassId);
  const selectPass = useSatelliteStore((s) => s.selectPass);
  const observer = useObserverStore((s) => s.location);
  const mask = useSettingsStore((s) => s.elevationMaskDeg);
  const { look, timeMs: nowMs } = useLiveLookAngles(1);

  const selectedPass = findPass(passes, selectedPassId);
  const next = currentOrNextPass(passes, nowMs);
  const obsLabel = observerLabel(observer);
  const zone = localZoneName(nowMs);

  const actions = (
    <>
      {(state === 'computing' || refreshing) && <LoaderCircle className="size-3 animate-spin text-muted" aria-label="Computing passes" />}
      {result && state === 'ready' && (
        <span className="hidden font-mono text-[11px] text-faint tabular md:inline">
          {passes.length} {passes.length === 1 ? 'pass' : 'passes'} · {formatDuration(result.scannedUntilMs - result.searchStartMs)}
        </span>
      )}
      <TrackedOnlyToggle />
      <MaskControl />
      <SearchSettings />
    </>
  );

  let body: ReactNode;
  if (!record) {
    body = <EmptyMessage>Select an object to predict its passes over {obsLabel}.</EmptyMessage>;
  } else if (state === 'error') {
    body = <EmptyMessage>Pass prediction failed: {error}</EmptyMessage>;
  } else if (state === 'computing' || !result) {
    body = <EmptyMessage>Searching passes of {record.name} over {obsLabel}…</EmptyMessage>;
  } else {
    const message = resultMessage(result, obsLabel);
    body = (
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line px-3 py-1.5 text-[12px]">
            <VisibilityIndicator look={look} mask={mask} />
            {next && (
              <span className="font-mono text-[12px] tabular">
                {isPassInProgress(next, nowMs) ? (
                  <span className="text-ok">Pass in progress · LOS in {formatCountdown(next.losMs - nowMs)}</span>
                ) : (
                  <span>
                    <span className="text-muted">Next AOS in </span>
                    <span className="text-accent">{formatCountdown(next.aosMs - nowMs)}</span>
                  </span>
                )}
              </span>
            )}
            <span className="ml-auto text-[11px] text-faint">
              {observer.source === 'default' && <span className="text-warn">Default observer · </span>}
              {obsLabel}
            </span>
          </div>
          {message ? (
            <EmptyMessage>{message}</EmptyMessage>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <PassTable
                passes={passes}
                zone={zone}
                nowMs={nowMs}
                selectedPassId={selectedPassId}
                onToggle={(p) => selectPass(p.id === selectedPassId ? null : p.id)}
              />
            </div>
          )}
        </div>
        <aside className="min-h-0 overflow-auto border-t border-line lg:w-[360px] lg:shrink-0 lg:border-t-0 lg:border-l">
          {selectedPass ? (
            <PassDetails pass={selectedPass} nowMs={nowMs} onClose={() => selectPass(null)} />
          ) : (
            <EmptyMessage>
              {passes.length ? 'Select a pass for its timeline, slant ranges and elevation profile.' : 'No pass to show.'}
            </EmptyMessage>
          )}
        </aside>
      </div>
    );
  }

  return (
    <Panel title="Upcoming passes" icon={CalendarClock} actions={actions} className="h-full">
      {body}
    </Panel>
  );
}

/** Plain-language summary of Tracked-list objects without a pass to list. */
function trackedNotes(
  results: ReadonlyMap<number, PassSearchResult>,
  failures: ReadonlyMap<number, string>,
  byId: ReadonlyMap<number, SatelliteRecord>,
): string[] {
  const name = (id: number) => byId.get(id)?.name ?? `NORAD ${id}`;
  const never: string[] = [];
  const always: string[] = [];
  const broken: string[] = [];
  for (const r of results.values()) {
    if (r.status === 'never-above-mask') never.push(name(r.noradId));
    else if (r.status === 'always-above-mask') always.push(name(r.noradId));
    else if (r.status === 'propagation-error') broken.push(name(r.noradId));
  }
  for (const id of failures.keys()) broken.push(name(id));
  const notes: string[] = [];
  if (never.length) notes.push(`Never above the mask in the search window: ${never.join(', ')}.`);
  if (always.length) notes.push(`Always above the mask (no rise or set): ${always.join(', ')}.`);
  if (broken.length) notes.push(`Could not be predicted: ${broken.join(', ')}.`);
  return notes;
}

/**
 * Combined schedule of every Tracked-list satellite, merged and sorted by AOS
 * (`mergePassSchedule`), with a Satellite column. Clicking a row selects that
 * satellite and pass together, so the sky plot and ground track follow it.
 */
function TrackedPasses() {
  const { state, passes, results, failures, pendingCount, totalCount, horizonMs, refreshing, error } = usePassPredictions();
  const byId = useSatelliteStore((s) => s.byId);
  const trackedCount = useSatelliteStore((s) => s.trackedRecords.length);
  const selectedPassId = useSatelliteStore((s) => s.selectedPassId);
  const { selectPass, selectSatellitePass } = useSatelliteStore.getState();
  const observer = useObserverStore((s) => s.location);
  const nowMs = useSimTimeMs(1);

  // Passes that ended since the last recompute drop out right away.
  const upcoming = passes.filter((p) => p.losMs > nowMs);
  const selectedPass = findPass(passes, selectedPassId);
  const next = currentOrNextPass(upcoming, nowMs);
  const inView = upcoming.filter((p) => isPassInProgress(p, nowMs));
  const obsLabel = observerLabel(observer);
  const zone = localZoneName(nowMs);
  const nameOf = (id: number) => byId.get(id)?.name ?? `NORAD ${id}`;
  const notes = trackedNotes(results, failures, byId);

  const actions = (
    <>
      {(pendingCount > 0 || refreshing) && <LoaderCircle className="size-3 animate-spin text-muted" aria-label="Computing passes" />}
      {totalCount > 0 && (
        <span className="hidden font-mono text-[11px] text-faint tabular md:inline" data-testid="tracked-pass-summary">
          {pendingCount > 0 ? `${totalCount - pendingCount}/${totalCount} objects searched · ` : `${totalCount} objects · `}
          {upcoming.length} {upcoming.length === 1 ? 'pass' : 'passes'}
        </span>
      )}
      <TrackedOnlyToggle />
      <MaskControl />
      <SearchSettings />
    </>
  );

  let body: ReactNode;
  if (trackedCount === 0) {
    body = (
      <EmptyMessage>
        The Tracked list is empty. Star objects in search results or on the selected-object strip to see their combined
        pass schedule over {obsLabel}.
      </EmptyMessage>
    );
  } else if (state === 'error') {
    body = <EmptyMessage>Pass prediction failed: {error}</EmptyMessage>;
  } else if (state === 'computing') {
    body = (
      <EmptyMessage>
        Searching passes of {totalCount} tracked {totalCount === 1 ? 'object' : 'objects'} over {obsLabel}…
      </EmptyMessage>
    );
  } else {
    body = (
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line px-3 py-1.5 text-[12px]">
            <span className="flex items-center gap-2">
              <span className={`inline-block size-2 rounded-full ${inView.length ? 'animate-pulse bg-ok' : 'bg-faint'}`} aria-hidden />
              <span className={inView.length ? 'text-ok' : 'text-muted'}>
                {inView.length ? `${inView.length} in view now` : 'None in view'}
              </span>
            </span>
            {next && (
              <span className="font-mono text-[12px] tabular" data-testid="tracked-next-pass">
                {isPassInProgress(next, nowMs) ? (
                  <span className="text-ok">
                    {nameOf(next.noradId)} · LOS in {formatCountdown(next.losMs - nowMs)}
                  </span>
                ) : (
                  <span>
                    <span className="text-muted">Next: {nameOf(next.noradId)} · AOS in </span>
                    <span className="text-accent">{formatCountdown(next.aosMs - nowMs)}</span>
                  </span>
                )}
              </span>
            )}
            <span className="ml-auto text-[11px] text-faint">
              {observer.source === 'default' && <span className="text-warn">Default observer · </span>}
              {obsLabel}
            </span>
          </div>
          {notes.length > 0 && (
            <div className="border-b border-line px-3 py-1 text-[11px] text-muted">
              {notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
          )}
          {upcoming.length === 0 ? (
            <EmptyMessage>No tracked object rises above the mask in the search window.</EmptyMessage>
          ) : (
            <div className="max-h-[480px] min-h-0 flex-1 overflow-auto">
              <PassTable
                passes={upcoming}
                zone={zone}
                nowMs={nowMs}
                selectedPassId={selectedPassId}
                satellites={byId}
                onToggle={(p) => (p.id === selectedPassId ? selectPass(null) : selectSatellitePass(p.noradId, p.id))}
              />
              {horizonMs !== null && (
                <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint">
                  Complete through {formatLocalDay(horizonMs)} {formatLocalTime(horizonMs)} ({zone}): each object is
                  searched for up to its next passes (Pass search settings), and the list stops where the first search
                  stopped, so no pass before that time is missing.
                </p>
              )}
            </div>
          )}
        </div>
        <aside className="min-h-0 overflow-auto border-t border-line lg:w-[360px] lg:shrink-0 lg:border-t-0 lg:border-l">
          {selectedPass ? (
            <PassDetails pass={selectedPass} nowMs={nowMs} onClose={() => selectPass(null)} />
          ) : (
            <EmptyMessage>
              {upcoming.length ? 'Select a pass for its timeline, slant ranges and elevation profile.' : 'No pass to show.'}
            </EmptyMessage>
          )}
        </aside>
      </div>
    );
  }

  return (
    <Panel title="Upcoming passes · Tracked list" icon={CalendarClock} actions={actions} className="h-full">
      {body}
    </Panel>
  );
}
