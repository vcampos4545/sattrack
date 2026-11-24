import { X } from 'lucide-react';
import { isPassInProgress, passDirection } from '../../core/orbit/pass-prediction';
import type { Pass, PassTrackSample } from '../../types/passes';
import { formatNumber, formatUtc } from '../../utils/format';
import { formatAzimuth, formatCountdown, formatLocalDay, formatLocalTime, formatPassDuration } from './pass-format';

/** The track sample closest in time to `timeMs`. Tracks always include AOS, max and LOS exactly. */
function sampleAt(track: readonly PassTrackSample[], timeMs: number): PassTrackSample | null {
  let best: PassTrackSample | null = null;
  for (const s of track) if (!best || Math.abs(s.timeMs - timeMs) < Math.abs(best.timeMs - timeMs)) best = s;
  return best;
}

const PROFILE_W = 320;
const PROFILE_H = 96;

/**
 * Elevation versus time over the pass, with the mask and the current
 * simulation time. Drawn from the pass's propagated track samples.
 */
function ElevationProfile({ pass, nowMs }: { pass: Pass; nowMs: number }) {
  const span = pass.losMs - pass.aosMs;
  const x = (t: number) => ((t - pass.aosMs) / span) * PROFILE_W;
  const y = (el: number) => PROFILE_H - (Math.max(0, el) / 90) * PROFILE_H;
  const path = pass.track.map((s, i) => `${i ? 'L' : 'M'}${x(s.timeMs).toFixed(1)},${y(s.elevationDeg).toFixed(1)}`).join('');
  const live = isPassInProgress(pass, nowMs);
  return (
    <svg
      viewBox={`0 0 ${PROFILE_W} ${PROFILE_H}`}
      className="h-24 w-full overflow-visible"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Elevation profile peaking at ${pass.maxElevationDeg.toFixed(1)} degrees`}
    >
      {[30, 60].map((el) => (
        <line key={el} x1={0} x2={PROFILE_W} y1={y(el)} y2={y(el)} stroke="var(--color-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      <line
        x1={0}
        x2={PROFILE_W}
        y1={y(pass.elevationMaskDeg)}
        y2={y(pass.elevationMaskDeg)}
        stroke="var(--color-warn)"
        strokeOpacity={0.6}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
      <path d={`${path}L${PROFILE_W},${PROFILE_H}L0,${PROFILE_H}Z`} fill="var(--color-accent)" fillOpacity={0.08} />
      <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {live && (
        <line x1={x(nowMs)} x2={x(nowMs)} y1={0} y2={PROFILE_H} stroke="var(--color-ok)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

function EventRow({ label, sample, timeMs }: { label: string; sample: PassTrackSample | null; timeMs: number }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-1 pr-2 text-left text-[10px] font-normal uppercase tracking-[0.12em] text-faint">
        {label}
      </th>
      <td className="py-1 pr-2">
        <div>{formatLocalTime(timeMs)}</div>
        <div className="text-[10px] text-faint">{formatUtc(timeMs).slice(11)}</div>
      </td>
      <td className="py-1 pr-2 text-right">{sample ? formatAzimuth(sample.azimuthDeg) : 'n/a'}</td>
      <td className="py-1 pr-2 text-right">{sample ? `${sample.elevationDeg.toFixed(1)}°` : 'n/a'}</td>
      <td className="py-1 text-right">{sample ? formatNumber(sample.rangeKm, 0) : 'n/a'}</td>
    </tr>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="truncate font-mono text-[12px] tabular">{value}</div>
    </div>
  );
}

/**
 * Detail view of one predicted pass: AOS / max / LOS events with local and
 * UTC times, look angles and slant range, plus an elevation profile.
 */
export function PassDetails({ pass, nowMs, onClose }: { pass: Pass; nowMs: number; onClose: () => void }) {
  const aos = sampleAt(pass.track, pass.aosMs);
  const max = sampleAt(pass.track, pass.maxElevationMs);
  const los = sampleAt(pass.track, pass.losMs);
  const minRange = pass.track.reduce((m, s) => Math.min(m, s.rangeKm), Number.POSITIVE_INFINITY);
  const dir = passDirection(pass);
  const live = isPassInProgress(pass, nowMs);
  const ended = nowMs >= pass.losMs;

  let status: string;
  let statusClass = 'text-muted';
  if (live) {
    status = `In progress · LOS in ${formatCountdown(pass.losMs - nowMs)}`;
    statusClass = 'text-ok';
  } else if (ended) {
    status = `Ended ${formatCountdown(nowMs - pass.losMs)} ago`;
  } else {
    status = `AOS in ${formatCountdown(pass.aosMs - nowMs)}`;
    statusClass = 'text-accent';
  }

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.12em] text-faint">Pass · {formatLocalDay(pass.aosMs)}</div>
          <div className={`font-mono text-[12px] tabular ${statusClass}`}>{status}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Clear pass selection" className="ml-auto text-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>

      <table className="w-full font-mono text-[12px] tabular">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.12em] text-faint">
            <th className="pb-1 text-left font-normal">Event</th>
            <th className="pb-1 text-left font-normal">Local / UTC</th>
            <th className="pb-1 pr-2 text-right font-normal">Az</th>
            <th className="pb-1 pr-2 text-right font-normal">El</th>
            <th className="pb-1 text-right font-normal">Range km</th>
          </tr>
        </thead>
        <tbody>
          <EventRow label={pass.inProgressAtSearchStart ? 'Start' : 'AOS'} sample={aos} timeMs={pass.aosMs} />
          <EventRow label="Max" sample={max} timeMs={pass.maxElevationMs} />
          <EventRow label="LOS" sample={los} timeMs={pass.losMs} />
        </tbody>
      </table>
      {pass.inProgressAtSearchStart && (
        <p className="text-[11px] text-warn">Already above the mask for the whole look-back; the start is the search start, not a rise.</p>
      )}

      <div className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-line pt-2">
        <Stat label="Duration" value={formatPassDuration(pass.durationS)} />
        <Stat label="Max el" value={`${pass.maxElevationDeg.toFixed(1)}°`} />
        <Stat label="Direction" value={`${dir.from} → ${dir.to}`} title={dir.heading} />
        <Stat label="Min range" value={`${formatNumber(minRange, 0)} km`} />
        <Stat
          label="Range rate"
          value={aos && los ? `${aos.rangeRateKmS.toFixed(2)} → ${los.rangeRateKmS > 0 ? '+' : ''}${los.rangeRateKmS.toFixed(2)}` : 'n/a'}
          title="km/s at AOS and LOS; negative approaching"
        />
        <Stat label="Mask" value={`${pass.elevationMaskDeg}°`} />
      </div>

      <div className="mt-auto border-t border-line pt-2">
        <div className="mb-1 flex text-[10px] uppercase tracking-[0.12em] text-faint">
          <span>Elevation</span>
          <span className="ml-auto">0–90°</span>
        </div>
        <ElevationProfile pass={pass} nowMs={nowMs} />
      </div>
    </div>
  );
}
