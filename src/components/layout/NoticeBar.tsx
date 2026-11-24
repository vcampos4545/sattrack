import { CircleAlert, HardDrive, RefreshCw, WifiOff, X } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { useBrowserOnline, useCatalogHealth } from '../../hooks/use-catalog-health';
import { getStorageStatus, subscribeStorageStatus } from '../../services/storage';
import { useSatelliteStore } from '../../stores/satellite-store';
import { formatDuration } from '../../utils/format';

interface Notice {
  key: string;
  tone: 'warn' | 'danger' | 'info';
  icon: typeof CircleAlert;
  text: ReactNode;
  action?: { label: string; run: () => void; busy?: boolean };
}

const TONE = {
  warn: 'border-warn/30 bg-warn/5 text-warn',
  danger: 'border-danger/30 bg-danger/5 text-danger',
  info: 'border-line bg-panel text-muted',
} as const;

/**
 * App-wide problems that affect every panel: no or failed orbital data,
 * offline operation, and storage that will not survive a reload. Each line
 * says what still works and what to do. Dismissed lines stay hidden until
 * their text changes.
 */
export function NoticeBar() {
  const health = useCatalogHealth();
  const online = useBrowserOnline();
  const storage = useSyncExternalStore(subscribeStorageStatus, getStorageStatus, getStorageStatus);
  const loadCatalog = useSatelliteStore((s) => s.loadCatalog);
  const loading = useSatelliteStore((s) => s.loadState === 'loading');
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const retry = { label: 'Retry', run: () => void loadCatalog({ force: true }), busy: loading };
  const notices: Notice[] = [];

  if (health.level === 'error' && health.headline) {
    notices.push({ key: `data:${health.headline}`, tone: 'danger', icon: CircleAlert, text: health.headline, action: retry });
  } else if (health.servingCacheAfterError) {
    const age = health.dataAgeMs === null ? '' : ` downloaded ${formatDuration(health.dataAgeMs)} ago`;
    notices.push({
      key: 'data:offline-cache',
      tone: 'warn',
      icon: WifiOff,
      text: (
        <>
          CelesTrak could not be reached, so the cached element sets{age} are in use. Positions and passes are still
          computed from them; accuracy drops slowly as they age. It retries automatically.
        </>
      ),
      action: retry,
    });
  } else if (health.level === 'warn' && health.headline) {
    notices.push({ key: `data:${health.headline}`, tone: 'warn', icon: CircleAlert, text: health.headline });
  }

  if (!online && health.level === 'ok') {
    notices.push({
      key: 'net:offline',
      tone: 'info',
      icon: WifiOff,
      text: 'Browser is offline. Tracking continues from cached element sets; data refresh resumes when the connection returns.',
    });
  }

  if (storage.cache === 'memory' || storage.preferences === 'memory') {
    const what =
      storage.preferences === 'memory' && storage.cache === 'memory'
        ? 'settings, location and cached orbital data'
        : storage.preferences === 'memory'
          ? 'settings, location and tracked objects'
          : 'cached orbital data';
    notices.push({
      key: `storage:${what}`,
      tone: 'info',
      icon: HardDrive,
      text: `Browser storage is unavailable (private mode or blocked), so ${what} will not be kept after this session.`,
    });
  }

  const shown = notices.filter((n) => !dismissed.has(n.key));
  if (shown.length === 0) return null;

  return (
    <div role="status" className="flex flex-col gap-px bg-line px-px pt-px">
      {shown.map((n) => (
        <div key={n.key} className={`flex items-center gap-2 border px-3 py-1.5 text-[12px] ${TONE[n.tone]}`} data-testid="notice">
          <n.icon className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 text-ink/90">{n.text}</span>
          {n.action && (
            <button
              type="button"
              onClick={n.action.run}
              disabled={n.action.busy}
              className="flex items-center gap-1 border border-line-strong px-2 py-0.5 font-mono text-[11px] text-ink hover:border-accent disabled:opacity-50"
            >
              <RefreshCw className={`size-3 ${n.action.busy ? 'animate-spin' : ''}`} aria-hidden />
              {n.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => setDismissed((d) => new Set(d).add(n.key))}
            aria-label="Dismiss"
            className="text-muted hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
