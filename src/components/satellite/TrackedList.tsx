import { Star, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSatelliteStore } from '../../stores/satellite-store';
import { CATEGORY_LABELS } from '../../types/satellite';
import { CATEGORY_COLORS } from '../../utils/category-colors';
import { useGlobeViewStore } from '../globe/globe-view-store';

/**
 * "Tracked only" filter switch. When on, the globe draws only Tracked-list
 * objects and the passes panel shows their combined schedule.
 */
export function TrackedOnlyToggle({ className = '' }: { className?: string }) {
  const on = useSatelliteStore((s) => s.trackedOnly);
  const count = useSatelliteStore((s) => s.trackedIds.length);
  const setTrackedOnly = useSatelliteStore((s) => s.setTrackedOnly);
  return (
    <button
      type="button"
      onClick={() => setTrackedOnly(!on)}
      aria-pressed={on}
      title={on ? 'Showing only Tracked-list objects. Click to show everything.' : 'Show only Tracked-list objects and their combined pass schedule'}
      data-testid="tracked-only-toggle"
      className={`flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[11px] hover:border-line-strong ${
        on ? 'border-accent/60 bg-panel-raised text-accent' : 'border-line text-faint'
      } ${className}`}
    >
      <Star className="size-3" fill={on ? 'currentColor' : 'none'} aria-hidden />
      Tracked only
      <span className="text-muted tabular">{count}</span>
    </button>
  );
}

/**
 * Tracked-list view: a button that opens the list of tracked objects, with
 * the "Tracked only" switch. Rows select the object (and turn the globe to
 * it); the star removes it from the list. Objects are added from search
 * results and the selected-object strip.
 */
export function TrackedListButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = useSatelliteStore((s) => s.trackedIds.length);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="tracked-list"
        title="Tracked list"
        className={`flex items-center gap-1 border px-1.5 py-0.5 text-[11px] hover:border-line-strong ${
          open ? 'border-line-strong bg-panel-raised text-ink' : 'border-line text-muted'
        }`}
      >
        <Star className="size-3" aria-hidden />
        <span className="hidden sm:inline">Tracked</span>
        <span className="tabular">{count}</span>
      </button>
      {open && (
        <div
          id="tracked-list"
          className="absolute top-full right-0 z-30 mt-1 w-[320px] border border-line-strong bg-panel-raised shadow-2xl shadow-black/50"
        >
          <TrackedListPanel onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function TrackedListPanel({ onClose }: { onClose: () => void }) {
  const trackedIds = useSatelliteStore((s) => s.trackedIds);
  const byId = useSatelliteStore((s) => s.byId);
  const selectedId = useSatelliteStore((s) => s.selectedId);
  const loading = useSatelliteStore((s) => s.loadState === 'loading');
  const { removeTracked, select } = useSatelliteStore.getState();

  return (
    <div className="font-sans">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Tracked list</h3>
        <TrackedOnlyToggle className="ml-auto" />
        <button type="button" onClick={onClose} aria-label="Close tracked list" className="text-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      {trackedIds.length === 0 ? (
        <p className="px-3 py-3 text-[12px] leading-relaxed text-muted">
          No tracked objects yet. Use the star in search results or on the selected-object strip to add one.
        </p>
      ) : (
        <ul className="max-h-[50vh] overflow-y-auto py-1" aria-label="Tracked objects">
          {trackedIds.map((id) => {
            const r = byId.get(id);
            return (
              <li
                key={id}
                className={`flex items-center gap-2 px-3 py-1 ${id === selectedId ? 'bg-line' : 'hover:bg-panel'} ${r ? 'cursor-pointer' : ''}`}
                onClick={() => {
                  if (!r) return;
                  select(id);
                  useGlobeViewStore.getState().requestFocus('selected');
                }}
              >
                <span className="inline-block size-2 shrink-0" style={{ background: r ? CATEGORY_COLORS[r.category] : 'transparent' }} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{r?.name ?? `NORAD ${id}`}</span>
                <span className="font-mono text-[11px] text-muted tabular">{id}</span>
                <span className="hidden w-20 truncate text-[10px] text-faint sm:inline">
                  {r ? CATEGORY_LABELS[r.category] : loading ? 'loading…' : 'not loaded'}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTracked(id);
                  }}
                  aria-label={`Remove ${r?.name ?? id} from the Tracked list`}
                  title="Remove from the Tracked list"
                  className="text-accent hover:text-ink"
                >
                  <Star className="size-3.5" fill="currentColor" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
