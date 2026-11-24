import { CloudDownload, Eye, EyeOff, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSatelliteStore } from '../../stores/satellite-store';
import { CATEGORY_LABELS, type SatelliteRecord } from '../../types/satellite';
import { CATEGORY_COLORS } from '../../utils/category-colors';
import { parseNoradQuery, searchSatellites } from '../../utils/satellite-search';
import { useGlobeViewStore } from '../globe/globe-view-store';

/**
 * Header search: find objects by name, NORAD catalog number or international
 * designator in the loaded catalog, select them, and add or remove them from
 * the tracked list. A NORAD number that is not in any enabled group can be
 * downloaded individually from CelesTrak (`trackNoradId`). Press "/" to focus.
 */
export function SatelliteSearch() {
  const satellites = useSatelliteStore((s) => s.satellites);
  const untrackedIds = useSatelliteStore((s) => s.untrackedIds);
  const extraStatus = useSatelliteStore((s) => s.extraStatus);
  const byId = useSatelliteStore((s) => s.byId);
  const loadState = useSatelliteStore((s) => s.loadState);
  const { select, trackNoradId, untrack, setCategoryVisible } = useSatelliteStore.getState();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /** NORAD id requested by number; selected as soon as its download lands. */
  const [pendingId, setPendingId] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const untracked = useMemo(() => new Set(untrackedIds), [untrackedIds]);
  const hits = useMemo(() => searchSatellites(satellites, query, 40), [satellites, query]);
  const queryId = parseNoradQuery(query);
  const offerDownload = queryId !== null && !byId.has(queryId);

  // Select a downloaded-by-number object once it appears in the catalog.
  useEffect(() => {
    if (pendingId !== null && byId.has(pendingId)) {
      activate(byId.get(pendingId)!);
      setPendingId(null);
    }
  }, [pendingId, byId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  /** Select an object (re-tracking it and un-hiding its category if needed) and turn the globe to it. */
  function activate(record: SatelliteRecord) {
    const s = useSatelliteStore.getState();
    if (s.untrackedIds.includes(record.noradId)) trackNoradId(record.noradId);
    if (!s.categoryFilter[record.category]) setCategoryVisible(record.category, true);
    select(record.noradId);
    useGlobeViewStore.getState().requestFocus('selected');
    setOpen(false);
    input.current?.blur();
  }

  function download(id: number) {
    trackNoradId(id);
    setPendingId(id);
  }

  const rowCount = hits.length + (offerDownload ? 1 : 0);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(rowCount - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      const hit = hits[active];
      if (hit) activate(hit.record);
      else if (offerDownload && active === hits.length && queryId !== null) download(queryId);
    } else if (e.key === 'Escape') {
      setOpen(false);
      input.current?.blur();
    }
  };

  const pendingStatus = pendingId === null ? null : extraStatus.find((x) => x.noradId === pendingId);
  const pendingFailed = pendingId !== null && loadState !== 'loading' && !byId.has(pendingId);

  return (
    <div ref={root} className="relative max-w-md">
      <label className="flex items-center gap-2 border border-line bg-base px-2 py-1 focus-within:border-line-strong">
        <Search className="size-3.5 shrink-0 text-muted" aria-hidden />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search name, NORAD ID or designator"
          aria-label="Search satellites"
          role="combobox"
          aria-expanded={open}
          aria-controls="satellite-search-results"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink placeholder:text-faint focus:outline-none"
        />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-muted hover:text-ink">
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd className="border border-line px-1 font-mono text-[10px] text-faint">/</kbd>
        )}
      </label>

      {(open || pendingId !== null) && (
        <div
          id="satellite-search-results"
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-[60vh] overflow-y-auto border border-line-strong bg-panel-raised shadow-2xl shadow-black/50"
        >
          {pendingId !== null && (
            <div className="flex items-center gap-2 border-b border-line px-2 py-1.5 font-mono text-[11px]">
              {pendingFailed ? (
                <span className="text-danger">
                  NORAD {pendingId}: {pendingStatus?.error ?? 'not found on CelesTrak'}
                </span>
              ) : (
                <>
                  <Loader2 className="size-3.5 animate-spin text-muted" />
                  <span className="text-muted">Downloading NORAD {pendingId} from CelesTrak…</span>
                </>
              )}
              <button type="button" onClick={() => setPendingId(null)} aria-label="Dismiss" className="ml-auto text-muted hover:text-ink">
                <X className="size-3" />
              </button>
            </div>
          )}
          {open && query.trim() === '' && <TrackedListManager />}
          {open &&
            hits.map((hit, i) => (
              <ResultRow
                key={hit.record.noradId}
                record={hit.record}
                active={i === active}
                tracked={!untracked.has(hit.record.noradId)}
                onHover={() => setActive(i)}
                onActivate={() => activate(hit.record)}
                onToggleTracked={() => (untracked.has(hit.record.noradId) ? trackNoradId(hit.record.noradId) : untrack(hit.record.noradId))}
              />
            ))}
          {open && offerDownload && queryId !== null && (
            <button
              type="button"
              role="option"
              aria-selected={active === hits.length}
              onMouseEnter={() => setActive(hits.length)}
              onClick={() => download(queryId)}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-[12px] ${active === hits.length ? 'bg-line' : ''}`}
            >
              <CloudDownload className="size-3.5 text-accent" />
              Download and track NORAD {queryId}
              <span className="ml-auto text-[10px] text-faint">not in loaded groups</span>
            </button>
          )}
          {open && query.trim() !== '' && hits.length === 0 && !offerDownload && (
            <p className="px-2 py-2 text-[12px] text-muted">
              No loaded object matches. Enter a NORAD number to download one, or enable more groups in Settings.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  record,
  active,
  tracked,
  onHover,
  onActivate,
  onToggleTracked,
}: {
  record: SatelliteRecord;
  active: boolean;
  tracked: boolean;
  onHover: () => void;
  onActivate: () => void;
  onToggleTracked: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      className={`flex cursor-pointer items-center gap-2 px-2 py-1 ${active ? 'bg-line' : ''} ${tracked ? '' : 'opacity-60'}`}
      onClick={onActivate}
    >
      <span className="inline-block size-2 shrink-0" style={{ background: CATEGORY_COLORS[record.category] }} />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{record.name}</span>
      <span className="font-mono text-[11px] text-muted tabular">{record.noradId}</span>
      <span className="hidden w-24 truncate text-[10px] text-faint sm:inline">{CATEGORY_LABELS[record.category]}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleTracked();
        }}
        title={tracked ? 'Remove from tracked objects' : 'Track this object'}
        aria-label={tracked ? `Untrack ${record.name}` : `Track ${record.name}`}
        className="flex items-center gap-1 border border-line px-1 py-0.5 text-[10px] text-muted hover:border-line-strong hover:text-ink"
      >
        {tracked ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        {tracked ? 'Untrack' : 'Track'}
      </button>
    </div>
  );
}

/** Shown on an empty query: objects added by number and objects removed from tracking. */
function TrackedListManager() {
  const byId = useSatelliteStore((s) => s.byId);
  const extraNoradIds = useSatelliteStore((s) => s.extraNoradIds);
  const untrackedIds = useSatelliteStore((s) => s.untrackedIds);
  const { trackNoradId, untrack } = useSatelliteStore.getState();
  const removed = untrackedIds.filter((id) => byId.has(id));

  if (extraNoradIds.length === 0 && removed.length === 0) {
    return <p className="px-2 py-2 text-[12px] text-muted">Type a satellite name (e.g. ISS, NOAA 19), a NORAD number or a designator.</p>;
  }
  const row = (id: number, action: 'untrack' | 'track') => {
    const r = byId.get(id);
    return (
      <li key={id} className="flex items-center gap-2 px-2 py-1">
        {r && <span className="inline-block size-2" style={{ background: CATEGORY_COLORS[r.category] }} />}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{r?.name ?? `NORAD ${id}`}</span>
        <span className="font-mono text-[11px] text-muted tabular">{id}</span>
        <button
          type="button"
          onClick={() => (action === 'track' ? trackNoradId(id) : untrack(id))}
          className="border border-line px-1 py-0.5 text-[10px] text-muted hover:border-line-strong hover:text-ink"
        >
          {action === 'track' ? 'Restore' : 'Remove'}
        </button>
      </li>
    );
  };
  return (
    <div className="py-1">
      {extraNoradIds.length > 0 && (
        <>
          <h4 className="px-2 pt-1 text-[10px] uppercase tracking-[0.12em] text-faint">Added by NORAD ID</h4>
          <ul>{extraNoradIds.map((id) => row(id, 'untrack'))}</ul>
        </>
      )}
      {removed.length > 0 && (
        <>
          <h4 className="px-2 pt-1 text-[10px] uppercase tracking-[0.12em] text-faint">Removed from tracking</h4>
          <ul>{removed.map((id) => row(id, 'track'))}</ul>
        </>
      )}
    </div>
  );
}
