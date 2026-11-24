import { CircleAlert, Database, RefreshCw, WifiOff } from 'lucide-react';
import { useCatalogHealth } from '../../hooks/use-catalog-health';
import { useSatelliteStore } from '../../stores/satellite-store';
import { formatDuration, formatLocal, formatUtc } from '../../utils/format';

/**
 * Header data status: catalog size, when the data was downloaded, offline
 * and freshness warnings, and the manual refresh button. Hover for per-source
 * details.
 */
export function CatalogStatus() {
  const loadState = useSatelliteStore((s) => s.loadState);
  const trackedCount = useSatelliteStore((s) => s.tracked.length);
  const groupStatus = useSatelliteStore((s) => s.groupStatus);
  const loadCatalog = useSatelliteStore((s) => s.loadCatalog);
  const health = useCatalogHealth();
  const loading = loadState === 'loading';

  const details = [
    health.oldestFetchMs !== null ? `Oldest download: ${formatLocal(health.oldestFetchMs)} (${formatUtc(health.oldestFetchMs)})` : '',
    `Element sets at displayed time: ${health.epochCounts.fresh} fresh (<3 d), ${health.epochCounts.aging} aging (3-14 d), ${health.epochCounts.stale} stale (14+ d)`,
    ...groupStatus.map(
      (g) =>
        `${g.groupId}: ${g.recordCount} objects, ${g.source}${g.fetchedAtMs ? `, downloaded ${formatUtc(g.fetchedAtMs)}` : ''}${g.rejectedCount ? `, ${g.rejectedCount} rejected` : ''}`,
    ),
    ...health.failedSources.map((f) => `${f.label}: ${f.error}`),
    health.headline ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  let alert: { text: string; tone: string; icon: typeof CircleAlert } | null = null;
  if (health.level === 'error') alert = { text: 'no data', tone: 'text-danger', icon: CircleAlert };
  else if (health.servingCacheAfterError) alert = { text: 'offline · cached', tone: 'text-warn', icon: WifiOff };
  else if (health.failedSources.length > 0)
    alert = { text: `${health.failedSources.length} source error`, tone: 'text-warn', icon: CircleAlert };
  else if (health.epochCounts.stale > 0)
    alert = { text: `${health.epochCounts.stale} stale`, tone: 'text-warn', icon: CircleAlert };

  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-muted tabular" title={details} data-testid="catalog-status">
      <Database className="size-3.5" aria-hidden />
      <span>{trackedCount.toLocaleString()} objects</span>
      {health.dataAgeMs !== null && (
        <span className="hidden text-faint md:inline">· updated {formatDuration(health.dataAgeMs)} ago</span>
      )}
      {alert && (
        <span className={`flex items-center gap-1 ${alert.tone}`}>
          <alert.icon className="size-3.5" aria-hidden />
          {alert.text}
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
