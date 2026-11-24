import { Radar } from 'lucide-react';
import type { ReactNode } from 'react';
import { angularSeparationDeg } from '../../core/orbit/sky-track';
import { useSimTimeMs } from '../../hooks/use-sim-time';
import { useObserverStore } from '../../stores/observer-store';
import { selectSelectedSatellite, useSatelliteStore } from '../../stores/satellite-store';
import { useSettingsStore } from '../../stores/settings-store';
import type { AntennaPointing, AzEl } from '../../types/antenna';
import type { LookAngles } from '../../types/orbital';
import type { Pass, PassTrackSample } from '../../types/passes';
import { CATEGORY_COLORS } from '../../utils/category-colors';
import { formatDuration, formatNumber } from '../../utils/format';
import { Panel } from '../layout/Panel';
import { AntennaOverlay } from './AntennaOverlay';
import { elevationRadius, projectAzEl } from './sky-projection';
import { SkyTrajectory } from './SkyTrajectory';
import { useSkyPlotData, type FocusKind, type SkyPlotData } from './use-sky-plot-data';

/** Horizon radius in SVG units. Labels sit outside it. */
const R = 100;
const VIEW = 117;
const ELEVATION_RINGS = [15, 30, 45, 60, 75] as const;
const CARDINALS = [
  { label: 'N', az: 0 },
  { label: 'E', az: 90 },
  { label: 'S', az: 180 },
  { label: 'W', az: 270 },
] as const;
const PAST_COLOR = '#7c8aa1';
const FOCUS_COLOR = '#4cc2ff';
const MARK_COLORS = { aos: '#3ecf8e', max: '#d5deeb', los: '#f0616d' } as const;

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const localTime = (ms: number) => timeFormatter.format(new Date(ms));

export interface SkyPlotProps {
  /**
   * Live antenna pointing from a future rotator controller. When given, the
   * plot overlays commanded and actual pointing and reports pointing error.
   * Not connected to any hardware yet.
   */
  antenna?: AntennaPointing | null;
}

/**
 * Slot: azimuth/elevation polar plot of the selected object over the
 * observer (spec section 7). North up, east right, zenith at the center.
 *
 * Shows the live past and predicted path around the current simulation time,
 * and annotates one pass with AOS / max / LOS: the pass selected in the
 * passes table, else the one in progress, else the next one.
 */
export function SkyPlot({ antenna = null }: SkyPlotProps) {
  const record = useSatelliteStore(selectSelectedSatellite);
  const observer = useObserverStore((s) => s.location);
  const maskDeg = useSettingsStore((s) => s.elevationMaskDeg);
  const timeMs = useSimTimeMs(2);

  const data = useSkyPlotData({ record, observer, timeMs });
  const color = record ? CATEGORY_COLORS[record.category] : FOCUS_COLOR;

  return (
    <Panel
      title="Local sky"
      icon={Radar}
      className="h-full"
      bodyClassName="flex flex-col sm:flex-row"
      actions={
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
          mask {maskDeg}°{observer.source === 'default' ? ' · default site' : ''}
        </span>
      }
    >
      <div className="relative min-h-[240px] min-w-0 flex-1 p-2">
        <SkyPlotChart
          maskDeg={maskDeg}
          past={data.past}
          future={data.future}
          current={data.current}
          focus={data.focus}
          focusKind={data.focusKind}
          color={color}
          name={record?.name ?? null}
          antenna={antenna}
        />
        {!record && (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12px] text-muted">
            Select an object to plot its path across your sky.
          </p>
        )}
      </div>
      {record && (
        <SkyReadout
          name={record.name}
          color={color}
          timeMs={timeMs}
          maskDeg={maskDeg}
          current={data.current}
          focus={data.focus}
          focusKind={data.focusKind}
          passStatus={data.passStatus}
          windowEndMs={data.windowEndMs}
          error={data.error}
          antenna={antenna}
        />
      )}
    </Panel>
  );
}

export interface SkyPlotChartProps {
  maskDeg: number;
  past: readonly PassTrackSample[];
  future: readonly PassTrackSample[];
  current: LookAngles | null;
  focus: Pass | null;
  focusKind: FocusKind | null;
  /** Category color of the object. */
  color: string;
  name: string | null;
  antenna?: AntennaPointing | null;
}

/**
 * The polar chart itself, data in, SVG out. Separate from the slot so a
 * future antenna-control view can reuse it with its own data source.
 */
export function SkyPlotChart({ maskDeg, past, future, current, focus, focusKind, color, name, antenna }: SkyPlotChartProps) {
  const maskR = elevationRadius(maskDeg, R);
  const currentPos = current && current.elevationDeg >= 0 ? projectAzEl(current.azimuthDeg, current.elevationDeg, R) : null;
  return (
    <svg
      viewBox={`${-VIEW} ${-VIEW} ${2 * VIEW} ${2 * VIEW}`}
      className="size-full select-none"
      role="img"
      aria-label={name ? `Sky plot of ${name}` : 'Sky plot'}
    >
      <defs>
        <pattern id="sky-mask-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke="var(--color-line-strong)" strokeWidth="1" />
        </pattern>
      </defs>

      {/* Sky disc and elevation mask band (between horizon and mask). */}
      <circle r={R} fill="var(--color-panel-raised)" />
      {maskDeg > 0 && (
        <path
          d={`M${-R} 0 A${R} ${R} 0 1 0 ${R} 0 A${R} ${R} 0 1 0 ${-R} 0 Z M${-maskR} 0 A${maskR} ${maskR} 0 1 1 ${maskR} 0 A${maskR} ${maskR} 0 1 1 ${-maskR} 0 Z`}
          fill="url(#sky-mask-hatch)"
          fillRule="evenodd"
          opacity={0.8}
        >
          <title>{`Below the ${maskDeg}° elevation mask`}</title>
        </path>
      )}
      {maskDeg > 0 && <circle r={maskR} fill="none" stroke="#f2b84b" strokeWidth={0.6} strokeDasharray="2 2" opacity={0.6} />}

      {/* Azimuth spokes every 30 deg, ticks every 10 deg. */}
      {Array.from({ length: 12 }, (_, i) => {
        const p = projectAzEl(i * 30, 0, R);
        return <line key={i} x1={0} y1={0} x2={p.x} y2={p.y} stroke="var(--color-line)" strokeWidth={0.5} />;
      })}
      {Array.from({ length: 36 }, (_, i) => {
        const a = projectAzEl(i * 10, 0, R);
        const b = projectAzEl(i * 10, i % 3 === 0 ? -4 : -2.5, R);
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-line-strong)" strokeWidth={0.6} />;
      })}
      {ELEVATION_RINGS.map((el) => (
        <g key={el}>
          <circle r={elevationRadius(el, R)} fill="none" stroke="var(--color-line-strong)" strokeWidth={0.5} strokeDasharray="1.5 2" />
          <text
            x={1.5}
            y={-elevationRadius(el, R) - 1.2}
            fill="var(--color-faint)"
            fontSize={6}
            fontFamily="var(--font-mono)"
          >
            {el}°
          </text>
        </g>
      ))}
      <circle r={R} fill="none" stroke="var(--color-muted)" strokeWidth={0.8} />
      <circle r={0.9} fill="var(--color-faint)" />

      {CARDINALS.map(({ label, az }) => {
        const p = projectAzEl(az, -9.5, R);
        return (
          <text
            key={label}
            x={p.x}
            y={p.y}
            fill={label === 'N' ? 'var(--color-ink)' : 'var(--color-muted)'}
            fontSize={9}
            fontWeight={600}
            fontFamily="var(--font-mono)"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {label}
          </text>
        );
      })}

      {/* Pass annotated with AOS / max / LOS. */}
      {focus && (
        <SkyTrajectory
          samples={focus.track}
          radius={R}
          color={FOCUS_COLOR}
          strokeWidth={focusKind === 'selected' ? 1.6 : 1.1}
          opacity={focusKind === 'selected' ? 0.95 : 0.55}
          dashed={focusKind === 'next'}
          arrowSpacing={45}
        />
      )}

      {/* Live path around now: past dim, predicted in the category color. */}
      <SkyTrajectory samples={past} radius={R} color={PAST_COLOR} strokeWidth={1} opacity={0.55} />
      <SkyTrajectory samples={future} radius={R} color={color} strokeWidth={1.4} arrowSpacing={32} />

      {focus && <PassMarks pass={focus} />}

      {antenna && (
        <AntennaOverlay
          antenna={antenna}
          target={current ? { azimuthDeg: current.azimuthDeg, elevationDeg: current.elevationDeg } : null}
          radius={R}
        />
      )}

      {currentPos && current && (
        <g transform={`translate(${currentPos.x} ${currentPos.y})`}>
          <title>{`${name ?? ''} az ${current.azimuthDeg.toFixed(1)}° el ${current.elevationDeg.toFixed(1)}°`}</title>
          <circle r={6} fill={color} opacity={0.18} />
          <circle r={3} fill={color} stroke="var(--color-base)" strokeWidth={1} />
          {name && <CurrentLabel name={name} at={currentPos} future={future} focus={focus} />}
        </g>
      )}
    </svg>
  );
}

/**
 * Name label next to the current-position marker. It sits perpendicular to
 * the direction of travel, so it never lies on the track, on whichever side
 * is farther from the pass marks (AOS / max / LOS), which are labeled too.
 * Coordinates are relative to the marker.
 */
function CurrentLabel({
  name,
  at,
  future,
  focus,
}: {
  name: string;
  at: { x: number; y: number };
  future: readonly PassTrackSample[];
  focus: Pass | null;
}) {
  const next = future.find((s) => s.elevationDeg >= -5 && s !== future[0]) ?? null;
  const ahead = next ? projectAzEl(next.azimuthDeg, next.elevationDeg, R) : { x: at.x, y: at.y - 1 };
  const len = Math.hypot(ahead.x - at.x, ahead.y - at.y) || 1;
  const nx = -(ahead.y - at.y) / len;
  const ny = (ahead.x - at.x) / len;
  const marks = focus
    ? [
        projectAzEl(focus.aosAzimuthDeg, focus.elevationMaskDeg, R),
        projectAzEl(focus.maxElevationAzimuthDeg, focus.maxElevationDeg, R),
        projectAzEl(focus.losAzimuthDeg, focus.elevationMaskDeg, R),
      ]
    : [];
  const clearance = (side: number) =>
    Math.min(Infinity, ...marks.map((m) => Math.hypot(at.x + side * 12 * nx - m.x, at.y + side * 12 * ny - m.y)));
  // Prefer the side toward the center when both are clear, so labels near the horizon stay inside the plot.
  const towardCenter = -(at.x * nx + at.y * ny) >= 0 ? 1 : -1;
  const side = clearance(-towardCenter) > clearance(towardCenter) + 8 ? -towardCenter : towardCenter;
  const x = side * 9 * nx;
  const y = side * 9 * ny;
  return (
    <text
      x={x}
      y={y}
      fill="var(--color-ink)"
      fontSize={6.5}
      fontFamily="var(--font-mono)"
      textAnchor={x > 2 ? 'start' : x < -2 ? 'end' : 'middle'}
      dominantBaseline="central"
    >
      {name}
    </text>
  );
}

/** AOS, maximum elevation and LOS points with their local times. */
function PassMarks({ pass }: { pass: Pass }) {
  const marks = [
    { key: 'aos', label: 'AOS', az: pass.aosAzimuthDeg, el: pass.elevationMaskDeg, t: pass.aosMs },
    { key: 'max', label: 'MAX', az: pass.maxElevationAzimuthDeg, el: pass.maxElevationDeg, t: pass.maxElevationMs },
    { key: 'los', label: 'LOS', az: pass.losAzimuthDeg, el: pass.elevationMaskDeg, t: pass.losMs },
  ] as const;
  return (
    <g>
      {marks.map((m) => {
        const p = projectAzEl(m.az, m.el, R);
        const c = MARK_COLORS[m.key];
        // Labels go toward the plot center so they never fall off the edge.
        const right = p.x < 0;
        const dx = right ? 6 : -6;
        return (
          <g key={m.key} transform={`translate(${p.x} ${p.y})`}>
            <title>{`${m.label} ${localTime(m.t)} · az ${m.az.toFixed(1)}° el ${m.el.toFixed(1)}°`}</title>
            {m.key === 'max' ? (
              <path d="M0 -3 L3 0 L0 3 L-3 0 Z" fill={c} stroke="var(--color-base)" strokeWidth={0.6} />
            ) : (
              <circle r={2.4} fill={c} stroke="var(--color-base)" strokeWidth={0.6} />
            )}
            <text
              x={dx}
              y={-1}
              fill={c}
              fontSize={6.5}
              fontWeight={600}
              fontFamily="var(--font-mono)"
              textAnchor={right ? 'start' : 'end'}
            >
              {m.label}
            </text>
            <text
              x={dx}
              y={6.5}
              fill="var(--color-muted)"
              fontSize={6}
              fontFamily="var(--font-mono)"
              textAnchor={right ? 'start' : 'end'}
            >
              {localTime(m.t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

const PASS_STATUS_TEXT: Record<NonNullable<SkyPlotData['passStatus']>, (maskDeg: number, windowEndMs: number) => string> = {
  computing: () => 'Predicting passes…',
  'never-above-mask': (mask, end) => `No pass above ${mask}° before ${new Date(end).toLocaleDateString()}.`,
  'always-above-mask': (mask) => `Stays above ${mask}° for the whole search window.`,
  'propagation-error': () => 'Pass search failed: SGP4 could not propagate these elements.',
};

const FOCUS_TITLES: Record<FocusKind, string> = {
  selected: 'Selected pass',
  'in-progress': 'Pass in progress',
  next: 'Next pass',
};

function Row({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="whitespace-nowrap text-[10px] uppercase tracking-[0.12em] text-faint">{label}</span>
      <span className={`truncate font-mono text-[12px] tabular ${className}`}>{value}</span>
    </div>
  );
}

interface SkyReadoutProps {
  name: string;
  color: string;
  timeMs: number;
  maskDeg: number;
  current: LookAngles | null;
  focus: Pass | null;
  focusKind: FocusKind | null;
  passStatus: SkyPlotData['passStatus'];
  windowEndMs: number;
  error: string | null;
  antenna: AntennaPointing | null;
}

function SkyReadout(props: SkyReadoutProps) {
  const { name, color, timeMs, maskDeg, current, focus, focusKind, passStatus, windowEndMs, error, antenna } = props;
  const status = !current
    ? null
    : current.elevationDeg >= maskDeg
      ? { text: 'Above mask', className: 'text-ok' }
      : current.elevationDeg >= 0
        ? { text: 'Below mask', className: 'text-warn' }
        : { text: 'Below horizon', className: 'text-muted' };
  const target: AzEl | null = current ? { azimuthDeg: current.azimuthDeg, elevationDeg: current.elevationDeg } : null;

  return (
    <aside className="flex shrink-0 flex-col gap-3 border-t border-line px-3 py-2.5 sm:w-[200px] sm:border-t-0 sm:border-l">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 shrink-0" style={{ background: color }} />
          <span className="truncate font-mono text-[13px] font-medium">{name}</span>
        </div>
        {status && <div className={`mt-0.5 text-[11px] ${status.className}`}>{status.text}</div>}
      </div>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      {current && (
        <div className="space-y-1">
          <Row label="Azimuth" value={`${current.azimuthDeg.toFixed(1)}°`} />
          <Row label="Elevation" value={`${current.elevationDeg.toFixed(1)}°`} />
          <Row label="Range" value={`${formatNumber(current.rangeKm, 0)} km`} />
          <Row
            label="Range rate"
            value={`${current.rangeRateKmS >= 0 ? '+' : ''}${current.rangeRateKmS.toFixed(2)} km/s`}
            className={current.rangeRateKmS < 0 ? 'text-ok' : 'text-muted'}
          />
        </div>
      )}

      {focus && focusKind && (
        <div className="space-y-1 border-t border-line pt-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-accent">{FOCUS_TITLES[focusKind]}</div>
            <div className="font-mono text-[11px] text-muted tabular">{passCountdown(focus, timeMs)}</div>
          </div>
          <Row label="AOS" value={`${localTime(focus.aosMs)} ${focus.aosAzimuthDeg.toFixed(0)}°`} />
          <Row label="Max" value={`${localTime(focus.maxElevationMs)} ${focus.maxElevationDeg.toFixed(1)}°`} />
          <Row label="LOS" value={`${localTime(focus.losMs)} ${focus.losAzimuthDeg.toFixed(0)}°`} />
          <Row label="Duration" value={formatDuration(focus.durationS * 1000)} />
        </div>
      )}
      {!focus && passStatus && (
        <p className="border-t border-line pt-2 text-[11px] text-muted">{PASS_STATUS_TEXT[passStatus](maskDeg, windowEndMs)}</p>
      )}

      {antenna && (antenna.commanded || antenna.actual) && (
        <div className="space-y-1 border-t border-line pt-2">
          <div className="text-[10px] uppercase tracking-[0.12em] text-faint">{antenna.label ?? 'Antenna'}</div>
          {antenna.commanded && (
            <Row label="Cmd" value={formatAzEl(antenna.commanded)} className="text-warn" />
          )}
          {antenna.actual && <Row label="Actual" value={formatAzEl(antenna.actual)} />}
          {antenna.actual && target && (
            <Row label="Point err" value={`${angularSeparationDeg(antenna.actual, target).toFixed(2)}°`} />
          )}
          {antenna.actual && antenna.commanded && (
            <Row label="Track err" value={`${angularSeparationDeg(antenna.actual, antenna.commanded).toFixed(2)}°`} />
          )}
        </div>
      )}
    </aside>
  );
}

function formatAzEl(p: AzEl): string {
  return `${p.azimuthDeg.toFixed(1)}° ${p.elevationDeg.toFixed(1)}°`;
}

function passCountdown(pass: Pass, timeMs: number): string {
  if (timeMs < pass.aosMs) return `AOS in ${formatDuration(pass.aosMs - timeMs)}`;
  if (timeMs <= pass.losMs) return `LOS in ${formatDuration(pass.losMs - timeMs)}`;
  return `ended ${formatDuration(timeMs - pass.losMs)} ago`;
}
