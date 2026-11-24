import { classifyEpochAge, epochAgeDays } from '../../core/orbit/time-utils';
import { useSelectedSatellite } from '../../hooks/use-selected-satellite';
import { CATEGORY_LABELS } from '../../types/satellite';
import { CATEGORY_COLORS } from '../../utils/category-colors';
import { formatLatitude, formatLongitude, formatNumber, formatUtc } from '../../utils/format';

const FRESHNESS_CLASS = { fresh: 'text-ok', aging: 'text-warn', stale: 'text-danger' } as const;

function Field({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className={`truncate font-mono text-[13px] tabular ${className}`}>{value}</div>
    </div>
  );
}

/**
 * Selected-object strip: identity, live propagated state at simulation time
 * and element-set metadata (inclination, period, epoch age).
 */
export function SatelliteInfo() {
  const { record, state, error, timeMs } = useSelectedSatellite(1);

  if (!record) {
    return (
      <section className="flex h-16 items-center border border-line bg-panel px-4 text-muted">
        <span className="mr-3 text-[11px] uppercase tracking-[0.12em] text-faint">Selected object</span>
        None selected.
      </section>
    );
  }

  const { tle } = record;
  const ageDays = epochAgeDays(tle.epochMs, timeMs);
  const freshness = classifyEpochAge(tle.epochMs, timeMs);

  return (
    <section className="grid grid-cols-2 gap-x-6 gap-y-2 border border-line bg-panel px-4 py-2.5 sm:grid-cols-4 xl:grid-cols-10">
      <div className="col-span-2 min-w-0">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-faint">
          <span className="inline-block size-2" style={{ background: CATEGORY_COLORS[record.category] }} />
          {CATEGORY_LABELS[record.category]}
        </div>
        <div className="truncate font-mono text-[14px] font-medium">{record.name}</div>
      </div>
      <Field label="NORAD ID" value={String(record.noradId)} />
      <Field label="Altitude" value={state ? `${formatNumber(state.geodetic.altitudeKm, 1)} km` : 'n/a'} />
      <Field label="Speed (inertial)" value={state ? `${formatNumber(state.inertialSpeedKmS, 3)} km/s` : 'n/a'} />
      <Field
        label="Sub-point"
        value={state ? `${formatLatitude(state.geodetic.latitudeDeg, 2)} ${formatLongitude(state.geodetic.longitudeDeg, 2)}` : 'n/a'}
      />
      <Field label="Inclination" value={`${tle.inclinationDeg.toFixed(2)}°`} />
      <Field label="Period" value={`${formatNumber(tle.periodMin, 1)} min`} />
      <Field
        label="Epoch"
        value={`${formatUtc(tle.epochMs).slice(0, 16)}Z · ${ageDays >= 0 ? '' : '-'}${formatNumber(Math.abs(ageDays), 1)} d`}
        className={FRESHNESS_CLASS[freshness]}
      />
      {error && <p className="col-span-full text-[12px] text-danger">{error}</p>}
    </section>
  );
}
