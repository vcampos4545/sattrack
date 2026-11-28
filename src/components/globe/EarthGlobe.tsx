import { Canvas } from '@react-three/fiber';
import { Crosshair, Earth, LocateFixed, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSelectedSatellite } from '../../hooks/use-selected-satellite';
import { useSimTimeMs } from '../../hooks/use-sim-time';
import { useObserverStore } from '../../stores/observer-store';
import { useSatelliteStore } from '../../stores/satellite-store';
import { useSettingsStore } from '../../stores/settings-store';
import { CATEGORY_LABELS } from '../../types/satellite';
import { CATEGORY_COLORS } from '../../utils/category-colors';
import { formatNumber } from '../../utils/format';
import { Panel } from '../layout/Panel';
import { WebGLGuard } from '../layout/WebGLGuard';
import { OrbitalElementsPanel } from '../satellite/OrbitalElementsPanel';
import { SatelliteFilters } from '../satellite/SatelliteFilters';
import { GlobeScene } from './GlobeScene';
import { GlobeToolbar } from './GlobeToolbar';
import type { GlobeLabels } from './globe-context';
import { useGlobeViewStore } from './globe-view-store';
import { BulkPropagator } from './propagation/bulk-propagator';

/**
 * Slot: primary 3D Earth globe. Live SGP4 positions of every visible object,
 * orbit paths, the observer, a lat/lon grid and the day/night terminator,
 * all driven by the simulation clock. See scene-frame.ts for the frames.
 */
export function EarthGlobe() {
  // One propagator (and worker) per mounted globe. Created in an effect so
  // StrictMode's mount/unmount/mount cycle never reuses a disposed one.
  const [propagator, setPropagator] = useState<BulkPropagator | null>(null);
  useEffect(() => {
    const p = new BulkPropagator();
    setPropagator(p);
    return () => p.dispose();
  }, []);
  const labels = useMemo<GlobeLabels>(() => ({ hover: null, observer: null }), []);

  return (
    <Panel title="Orbital view" icon={Earth} className="h-full" actions={<GlobeToolbar />}>
      <div className="relative h-full w-full overflow-hidden bg-[#02040a]">
        <WebGLGuard view="3D globe">
          {(webgl) =>
            propagator && (
              <Canvas
                flat
                dpr={[1, 2]}
                camera={{ fov: 38, near: 0.005, far: 1000, position: [0, 0, 3.4] }}
                gl={{ antialias: true }}
                onCreated={webgl.onCreated}
              >
                <GlobeScene propagator={propagator} labels={labels} />
              </Canvas>
            )
          }
        </WebGLGuard>
        <ObserverLabel labels={labels} />
        <HoverLabel labels={labels} />
        <SelectedOverlay />
        <ViewButtons />
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 flex items-end justify-between gap-4 p-2">
          <div className="pointer-events-auto min-w-0">
            <SatelliteFilters />
          </div>
          <GlobeStatus propagator={propagator} />
        </div>
        <CatalogOverlay />
      </div>
    </Panel>
  );
}

function ViewButtons() {
  const requestFocus = useGlobeViewStore((s) => s.requestFocus);
  const hasSelection = useSatelliteStore((s) => s.selectedId !== null);
  const btn = 'border border-line bg-panel/80 p-1.5 text-muted backdrop-blur hover:border-line-strong hover:text-ink disabled:opacity-40';
  return (
    <div className="absolute top-2 right-2 flex flex-col gap-1">
      <button type="button" className={btn} onClick={() => requestFocus('observer')} title="Center on observer" aria-label="Center on observer">
        <LocateFixed className="size-3.5" />
      </button>
      <button
        type="button"
        className={btn}
        disabled={!hasSelection}
        onClick={() => requestFocus('selected')}
        title="Center on selected object"
        aria-label="Center on selected object"
      >
        <Crosshair className="size-3.5" />
      </button>
    </div>
  );
}

/** Compact card for the selected object (full details are in the strip below). */
function SelectedOverlay() {
  const { record, state, error, timeMs } = useSelectedSatellite(2);
  const select = useSatelliteStore((s) => s.select);
  if (!record) return null;
  return (
    <div className="absolute top-2 left-2 max-h-[calc(100%-4rem)] w-64 overflow-y-auto border border-line-strong bg-panel/85 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-faint">
        <span className="inline-block size-2" style={{ background: CATEGORY_COLORS[record.category] }} />
        {CATEGORY_LABELS[record.category]} · {record.noradId}
        <button type="button" onClick={() => select(null)} aria-label="Clear selection" className="ml-auto text-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="truncate font-mono text-[13px] font-medium">{record.name}</div>
      {state ? (
        <dl className="mt-1 grid grid-cols-2 gap-x-3 font-mono text-[11px] tabular">
          <dt className="text-faint">Alt</dt>
          <dd className="text-right">{formatNumber(state.geodetic.altitudeKm, 1)} km</dd>
          <dt className="text-faint">Speed</dt>
          <dd className="text-right">{formatNumber(state.inertialSpeedKmS, 3)} km/s</dd>
        </dl>
      ) : (
        <p className="mt-1 text-[11px] text-danger">{error ?? 'No position'}</p>
      )}
      <OrbitalElementsPanel record={record} timeMs={timeMs} />
    </div>
  );
}

function GlobeStatus({ propagator }: { propagator: BulkPropagator | null }) {
  useSimTimeMs(1);
  const count = useSatelliteStore((s) => s.visible.length);
  const hz = useSettingsStore((s) => s.propagationHz);
  const latest = propagator?.latest;
  const failed = latest ? count - latest.okCount : 0;
  return (
    <div className="pointer-events-none shrink-0 text-right font-mono text-[10px] leading-relaxed text-faint tabular">
      <div>
        {count.toLocaleString()} objects · SGP4 {hz} Hz
        {failed > 0 && <span className="text-warn"> · {failed} not propagated</span>}
      </div>
      <div>drag rotate · scroll zoom · click select</div>
    </div>
  );
}

function CatalogOverlay() {
  const loadState = useSatelliteStore((s) => s.loadState);
  const loadError = useSatelliteStore((s) => s.loadError);
  const empty = useSatelliteStore((s) => s.satellites.length === 0);
  const emptyTrackedOnly = useSatelliteStore((s) => s.trackedOnly && s.trackedRecords.length === 0);
  if (!empty && !emptyTrackedOnly) return null;
  const text = !empty
    ? 'Tracked only is on and the Tracked list is empty. Star objects in search to add them.'
    : loadState === 'error'
      ? (loadError ?? 'Catalog failed to load')
      : 'Loading catalog from CelesTrak…';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 flex justify-center">
      <span className={`border border-line bg-panel/90 px-3 py-1.5 font-mono text-[12px] ${empty && loadState === 'error' ? 'text-danger' : 'text-muted'}`}>
        {text}
      </span>
    </div>
  );
}

/** Positioned each frame by ObserverMarker via `placeLabel`. */
function ObserverLabel({ labels }: { labels: GlobeLabels }) {
  const location = useObserverStore((s) => s.location);
  const name = location.source === 'default' ? 'Observer (default)' : (location.label ?? 'Observer');
  return (
    <div
      ref={(el) => {
        labels.observer = el;
      }}
      data-globe-label="observer"
      className="pointer-events-none invisible absolute top-0 left-0"
    >
      <span className="ml-3 inline-block -translate-y-1/2 border border-white/25 bg-black/60 px-1 font-mono text-[10px] whitespace-nowrap text-white">
        {name}
      </span>
    </div>
  );
}

/** Name and NORAD id of the hovered marker; positioned by GlobePointer. */
function HoverLabel({ labels }: { labels: GlobeLabels }) {
  const hoveredId = useGlobeViewStore((s) => s.hoveredId);
  const record = useSatelliteStore((s) => (hoveredId === null ? null : (s.byId.get(hoveredId) ?? null)));
  return (
    <div
      ref={(el) => {
        labels.hover = el;
      }}
      data-globe-label="hover"
      className="pointer-events-none invisible absolute top-0 left-0 z-10"
    >
      {record && (
        <div className="ml-3 -translate-y-1/2 border border-line-strong bg-panel-raised/95 px-2 py-1 whitespace-nowrap shadow-lg shadow-black/40">
          <div className="font-mono text-[12px] text-ink">{record.name}</div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted tabular">
            <span className="inline-block size-1.5" style={{ background: CATEGORY_COLORS[record.category] }} />
            NORAD {record.noradId} · {CATEGORY_LABELS[record.category]}
          </div>
        </div>
      )}
    </div>
  );
}
