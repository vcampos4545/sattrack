import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { orbitalElements } from '../../core/orbit/orbital-elements';
import { satrecFor } from '../../core/orbit/sgp4';
import { classifyEpochAge, epochAgeDays } from '../../core/orbit/time-utils';
import type { SatelliteRecord } from '../../types/satellite';
import { formatNumber, formatUtc } from '../../utils/format';

const AGE_CLASS = { fresh: 'text-ink', aging: 'text-warn', stale: 'text-danger' } as const;

/**
 * Collapsible list of the selected object's SGP4 mean elements at the TLE
 * epoch (not osculating elements at sim time). Collapsed by default.
 */
export function OrbitalElementsPanel({ record, timeMs }: { record: SatelliteRecord; timeMs: number }) {
  const [open, setOpen] = useState(false);
  const el = useMemo(() => {
    try {
      return orbitalElements(satrecFor(record.tle));
    } catch {
      return null;
    }
  }, [record]);
  if (!el) return null;
  const age = epochAgeDays(el.epochMs, timeMs);
  const rows: [string, string][] = [
    ['Incl', `${el.inclinationDeg.toFixed(4)}°`],
    ['Ecc', el.eccentricity.toFixed(7)],
    ['RAAN', `${el.raanDeg.toFixed(4)}°`],
    ['Arg per', `${el.argPerigeeDeg.toFixed(4)}°`],
    ['Mean anom', `${el.meanAnomalyDeg.toFixed(4)}°`],
    ['Mean mot', `${el.meanMotionRevPerDay.toFixed(5)} rev/d`],
    ['Period', `${formatNumber(el.periodMin, 2)} min`],
    ['SMA', `${formatNumber(el.semiMajorAxisKm, 1)} km`],
    ['Perigee', `${formatNumber(el.perigeeAltKm, 1)} km`],
    ['Apogee', `${formatNumber(el.apogeeAltKm, 1)} km`],
    ['B*', `${el.bstar.toExponential(4)} 1/R⊕`],
  ];
  return (
    <div className="mt-1 border-t border-line pt-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-faint hover:text-ink"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        Orbital elements
      </button>
      {open && (
        <>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 font-mono text-[11px] tabular" data-testid="orbital-elements">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-faint">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
            <dt className="text-faint">Epoch</dt>
            <dd className="text-right">{formatUtc(el.epochMs)}</dd>
            <dt className="text-faint">Age</dt>
            <dd className={`text-right ${AGE_CLASS[classifyEpochAge(el.epochMs, timeMs)]}`}>
              {formatNumber(age, 2)} d
            </dd>
          </dl>
          <p className="mt-1 text-[9px] leading-snug text-faint">SGP4 mean elements at TLE epoch, not osculating at sim time.</p>
        </>
      )}
    </div>
  );
}
