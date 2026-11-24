import { CircleAlert, Database, RefreshCw } from 'lucide-react';
import { useSimTimeMs } from '../../hooks/use-sim-time';
import { useSatelliteStore } from '../../stores/satellite-store';
import { formatDuration, formatUtc } from '../../utils/format';

/** Catalog size, data age, errors and the manual refresh button. */
export function CatalogStatus() {
  const loadState = useSatelliteStore((s) => s.loadState);
  const loadError = useSatelliteStore((s) => s.loadError);
  const trackedCount = useSatelliteStore((s) => s.tracked.length);
  const groupStatus = useSatelliteStore((s) => s.groupStatus);
  const loadCatalog = useSatelliteStore((s) => s.loadCatalog);
  // Re-render every 30 s so the "updated ... ago" text stays current.
  useSimTimeMs(1 / 30);
  const wallNow = Date.now(); // data age is wall-clock age, not simulation time

  const fetchedTimes = groupStatus.map((g) => g.fetchedAtMs).filter((t): t is number => t !== null);
  const oldestFetch = fetchedTimes.length ? Math.min(...fetchedTimes) : null;
  const groupErrors = groupStatus.filter((g) => g.error);
  const offline = groupErrors.some((g) => g.source === 'cache');
  const loading = loadState === 'loading';

  const details = [
    ...groupStatus.map(
      (g) =>
        `${g.groupId}: ${g.recordCount} objects, ${g.source}${g.fetchedAtMs ? `, downloaded ${formatUtc(g.fetchedAtMs)}` : ''}${g.rejectedCount ? `, ${g.rejectedCount} rejected` : ''}${g.error ? `, error: ${g.error}` : ''}`,
    ),
    loadError ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-muted tabular" title={details}>
      <Database className="size-3.5" aria-hidden />
      <span>{trackedCount.toLocaleString()} objects</span>
      {oldestFetch !== null && <span className="text-faint">· data {formatDuration(wallNow - oldestFetch)} old</span>}
      {(groupErrors.length > 0 || loadState === 'error') && (
        <span className={`flex items-center gap-1 ${offline ? 'text-warn' : 'text-danger'}`}>
          <CircleAlert className="size-3.5" aria-hidden />
          {loadState === 'error' ? 'no data' : offline ? 'offline, cached' : `${groupErrors.length} group error`}
        </span>
      )}
      <button
        type="button"
        onClick={() => void loadCatalog({ force: true })}
        disabled={loading}
        aria-label="Refresh orbital data"
        title="Refresh orbital data from CelesTrak (at most once per 2 hours per group)"
        className="border border-line p-1 hover:border-line-strong disabled:opacity-50"
      >
        <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
      </button>
    </div>
  );
}
