import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Crosshair, Globe } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { computeGroundTrack, groundTrackHeadingDeg, groundTrackWindow } from '../../core/orbit/ground-track';
import { observerFootprintVisibility } from '../../core/orbit/footprint';
import { satrecFor, type SatRec } from '../../core/orbit/sgp4';
import { useSelectedSatellite } from '../../hooks/use-selected-satellite';
import { useSimTimeMs } from '../../hooks/use-sim-time';
import { useObserverStore } from '../../stores/observer-store';
import { selectSelectedSatellite, useSatelliteStore } from '../../stores/satellite-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useTimeStore } from '../../stores/time-store';
import type { ObserverLocation } from '../../types/observer';
import { CATEGORY_COLORS } from '../../utils/category-colors';
import { formatLatitude, formatLongitude, formatNumber } from '../../utils/format';
import { Panel } from '../layout/Panel';
import { WebGLGuard } from '../layout/WebGLGuard';
import { GroundTrackPath } from './GroundTrackPath';
import { EMPTY_LIVE, useLiveSatelliteDriver, type LiveSatellite } from './live-satellite';
import { SatelliteFootprint } from './SatelliteFootprint';
import { geoToVector, GT_COLORS } from './scene-geometry';
import { CameraFollow, GlobeSurface, ObserverMarker, SubSatelliteMarker } from './scene-objects';

/** Historical track length, orbital periods. */
const PAST_REVS = 0.5;
/** Choices for the predicted track length, orbital periods. */
const AHEAD_CHOICES = [1, 2, 3] as const;
const CAMERA_DISTANCE = 3.6;
/** Footprint mask slider range, degrees (the setting itself accepts 0-89). */
const MIN_EL_SLIDER_MAX = 60;

/**
 * Secondary 3D globe (spec section 5): the selected object's past and
 * predicted ground track, its coverage footprint for the configured minimum
 * elevation, the current sub-satellite point and the observer.
 *
 * Earth-fixed view: the globe does not rotate with time because ground-track
 * points are already Earth-fixed. All positions come from core/orbit; this
 * component only draws them.
 */
export function GroundTrackGlobe() {
  const record = useSatelliteStore(selectSelectedSatellite);
  const observer = useObserverStore((s) => s.location);
  const minElevationDeg = useSettingsStore((s) => s.footprintMinElevationDeg);
  // Track length is a persisted preference; follow mode is per session (a drag turns it off).
  const aheadRevs = useSettingsStore((s) => s.groundTrackAheadRevs);
  const updateSettings = useSettingsStore((s) => s.update);
  const setAheadRevs = (v: number) => updateSettings({ groundTrackAheadRevs: v });
  const [follow, setFollow] = useState(true);
  const live = useRef<LiveSatellite>({ ...EMPTY_LIVE });

  const { satrec, satrecError } = useMemo((): { satrec: SatRec | null; satrecError: string | null } => {
    if (!record) return { satrec: null, satrecError: null };
    try {
      return { satrec: satrecFor(record.tle), satrecError: null };
    } catch (err) {
      return { satrec: null, satrecError: (err as Error).message };
    }
  }, [record]);

  // Start looking at the observer; follow mode then swings to the satellite.
  const [initialCamera] = useState(() => geoToVector(observer.latitudeDeg, observer.longitudeDeg, CAMERA_DISTANCE).toArray());

  return (
    <Panel
      title="Ground track & footprint"
      icon={Globe}
      className="h-full"
      bodyClassName="relative"
      actions={
        <>
          <MinElevationControl />
          <Segmented label="Ahead" value={aheadRevs} options={AHEAD_CHOICES} suffix="rev" onChange={setAheadRevs} />
          <button
            type="button"
            onClick={() => setFollow(!follow)}
            aria-pressed={follow}
            title={follow ? 'Following the sub-satellite point (drag the globe to stop)' : 'Follow the sub-satellite point'}
            className={`flex items-center gap-1 border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] hover:border-line-strong ${follow ? 'border-accent/50 text-accent' : 'border-line text-muted'}`}
          >
            <Crosshair className="size-3" aria-hidden />
            Follow
          </button>
        </>
      }
    >
      <div
        className="absolute inset-0"
        // A drag means the user wants to look around: stop following.
        onPointerMove={(e) => {
          if (e.buttons !== 0 && follow) setFollow(false);
        }}
      >
        <WebGLGuard view="Ground track globe">
          {(webgl) => (
        /* `flat`: no tone mapping, so map and overlay colors match the CSS design tokens exactly. */
        <Canvas
          flat
          camera={{ position: initialCamera, fov: 35, near: 0.01, far: 100 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onCreated={webgl.onCreated}
        >
          <GroundTrackScene
            live={live}
            satrec={satrec}
            periodMin={record?.tle.periodMin ?? 0}
            aheadRevs={aheadRevs}
            observer={observer}
            minElevationDeg={minElevationDeg}
            follow={follow}
            markerColor={record ? CATEGORY_COLORS[record.category] : GT_COLORS.subPoint}
          />
          <OrbitControls enablePan={false} enableDamping dampingFactor={0.12} rotateSpeed={0.5} minDistance={1.35} maxDistance={8} />
        </Canvas>
          )}
        </WebGLGuard>
      </div>

      <Legend />
      {record ? (
        <Readout live={live} observer={observer} minElevationDeg={minElevationDeg} error={satrecError} />
      ) : (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12px] text-muted">
          Select an object to show its ground track and footprint.
        </div>
      )}
    </Panel>
  );
}

interface SceneProps {
  live: RefObject<LiveSatellite>;
  satrec: SatRec | null;
  periodMin: number;
  aheadRevs: number;
  observer: ObserverLocation;
  minElevationDeg: number;
  follow: boolean;
  markerColor: string;
}

function GroundTrackScene({ live, satrec, periodMin, aheadRevs, observer, minElevationDeg, follow, markerColor }: SceneProps) {
  useLiveSatelliteDriver(live, satrec, observer, minElevationDeg);
  return (
    <>
      <GlobeSurface />
      {satrec && <TrackLayer satrec={satrec} periodMin={periodMin} aheadRevs={aheadRevs} />}
      <SatelliteFootprint live={live} />
      <ObserverMarker observer={observer} live={live} />
      <SubSatelliteMarker live={live} color={markerColor} />
      <CameraFollow live={live} enabled={follow} />
    </>
  );
}

/** Longest interval between track regenerations, ms. */
const MAX_REGEN_MS = 2 * 3_600_000;

/**
 * Samples the ground track for a window around simulation time. The samples
 * are regenerated only when time leaves the current window (a "bucket"), not
 * per frame or per tick; the bucket widens with the playback rate so fast
 * playback does not outrun it between the 2 Hz React updates. The exact
 * past/future split is drawn per frame by GroundTrackPath.
 */
function TrackLayer({ satrec, periodMin, aheadRevs }: { satrec: SatRec; periodMin: number; aheadRevs: number }) {
  const timeMs = useSimTimeMs(2);
  const rate = useTimeStore((s) => (s.paused ? 0 : s.rate));
  const win = groundTrackWindow(periodMin, PAST_REVS, aheadRevs);
  const bucketMs = Math.min(MAX_REGEN_MS, Math.max(win.stepMs * 8, Math.abs(rate) * 1000));
  const anchor = Math.floor(timeMs / bucketMs) * bucketMs;
  const points = useMemo(
    () => computeGroundTrack(satrec, anchor - win.pastMs - bucketMs, anchor + win.futureMs + 2 * bucketMs, win.stepMs),
    [satrec, anchor, bucketMs, win.pastMs, win.futureMs, win.stepMs],
  );
  return <GroundTrackPath points={points} pastMs={win.pastMs} futureMs={win.futureMs} />;
}

function Readout({
  live,
  observer,
  minElevationDeg,
  error,
}: {
  live: RefObject<LiveSatellite>;
  observer: ObserverLocation;
  minElevationDeg: number;
  error: string | null;
}) {
  // Text refreshes at 2 Hz from its own propagation; the 3D scene runs per frame.
  const { state, error: propagationError } = useSelectedSatellite(2);
  const problem = error ?? propagationError;
  if (problem || !state) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12px] text-danger">
        {problem ?? 'No position available.'}
      </div>
    );
  }
  const heading = groundTrackHeadingDeg(state);
  const vis = observerFootprintVisibility(state.ecef.positionKm, observer, minElevationDeg);
  // The footprint is recomputed by the scene; its radius changes only with altitude and mask.
  const fp = live.current.footprint;
  return (
    <>
      <dl className="pointer-events-none absolute bottom-2 left-2 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 border border-line bg-base/80 px-2.5 py-1.5 font-mono text-[11px] tabular backdrop-blur-sm">
        <dt className="text-faint">SSP</dt>
        <dd>
          {formatLatitude(state.geodetic.latitudeDeg, 2)} {formatLongitude(state.geodetic.longitudeDeg, 2)}
        </dd>
        <dt className="text-faint">ALT</dt>
        <dd>
          {formatNumber(state.geodetic.altitudeKm, 1)} km <span className="text-faint">HDG</span> {heading.toFixed(0).padStart(3, '0')}°
        </dd>
        <dt className="text-faint">FOOTPRINT</dt>
        <dd>{fp ? `r ${formatNumber(fp.groundRadiusKm, 0)} km @ ${fp.minElevationDeg.toFixed(0)}°` : 'n/a'}</dd>
        <dt className="text-faint">OBSERVER</dt>
        <dd className={vis.inside ? 'text-ok' : 'text-muted'}>
          el {vis.elevationDeg.toFixed(1)}° {vis.inside ? '· in footprint' : '· outside'}
        </dd>
      </dl>
      {vis.inside && (
        <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-1.5 border border-ok/40 bg-ok/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-ok">
          <span className="size-1.5 animate-pulse rounded-full bg-ok" />
          Observer in footprint
        </div>
      )}
    </>
  );
}

function Legend() {
  const item = (swatch: ReactNode, label: string) => (
    <li className="flex items-center gap-1.5">
      {swatch}
      {label}
    </li>
  );
  const bar = (color: string) => <span className="inline-block h-0.5 w-3" style={{ background: color }} />;
  return (
    <ul className="pointer-events-none absolute top-2 left-2 flex flex-col gap-0.5 text-[10px] uppercase tracking-[0.1em] text-muted">
      {item(bar(GT_COLORS.past), 'Past')}
      {item(bar(GT_COLORS.future), 'Predicted')}
      {item(<span className="inline-block size-2.5 rounded-full border" style={{ borderColor: GT_COLORS.footprint }} />, 'Footprint')}
      {item(<span className="inline-block size-2 rotate-45" style={{ background: GT_COLORS.observer }} />, 'Observer')}
    </ul>
  );
}

function MinElevationControl() {
  const value = useSettingsStore((s) => s.footprintMinElevationDeg);
  const update = useSettingsStore((s) => s.update);
  return (
    <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-muted" title="Minimum ground elevation angle for the coverage footprint">
      Min el
      <input
        type="range"
        min={0}
        max={MIN_EL_SLIDER_MAX}
        step={1}
        value={Math.min(value, MIN_EL_SLIDER_MAX)}
        onChange={(e) => update({ footprintMinElevationDeg: Number(e.target.value) })}
        className="h-1 w-16 accent-[var(--color-accent)]"
        aria-label="Footprint minimum elevation, degrees"
      />
      <span className="w-6 text-right font-mono text-ink tabular">{value.toFixed(0)}°</span>
    </label>
  );
}

function Segmented<T extends number>({
  label,
  value,
  options,
  suffix,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  suffix: string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-muted" role="group" aria-label={`${label} (${suffix})`}>
      {label}
      <div className="flex border border-line">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            aria-pressed={o === value}
            className={`px-1.5 font-mono text-[10px] ${o === value ? 'bg-panel-raised text-ink' : 'text-muted hover:text-ink'}`}
          >
            {o}
          </button>
        ))}
      </div>
      <span className="lowercase">{suffix}</span>
    </div>
  );
}
