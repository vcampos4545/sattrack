import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BufferAttribute, BufferGeometry, Color, LineBasicMaterial } from 'three';
import { orbitWindowBounds, type OrbitWindow } from '../../core/orbit/orbit-sampling';
import { orbitalPeriodMin, sampleTrajectory } from '../../core/orbit/satellite-propagator';
import { satrecFor } from '../../core/orbit/sgp4';
import { selectSelectedSatellite, useSatelliteStore } from '../../stores/satellite-store';
import { useSettingsStore } from '../../stores/settings-store';
import { getSimTimeMs } from '../../stores/time-store';
import type { SatelliteRecord } from '../../types/satellite';
import { CATEGORY_COLORS } from '../../utils/category-colors';
import { useGlobeContext } from './globe-context';
import { writeSceneFromKm } from './scene-frame';

/**
 * Share of the drawn path that lies in the past. The rest is the predicted
 * path, so the orbit reads as "where it is going" with a short trail.
 */
export const ORBIT_TRAIL_FRACTION = 0.25;
/**
 * Paths are sampled once around a center time and only regenerated when the
 * simulation clock drifts more than this share of the path span from it (or
 * the selection, element set or settings change). Never per frame.
 */
const REGENERATE_DRIFT_FRACTION = 0.2;
/** Samples per orbital period for the selected path (2 degrees of anomaly). */
const SELECTED_SAMPLES_PER_PERIOD = 180;

/** Orbit paths: the selected object prominent, optionally all visible objects faint. */
export function OrbitPaths() {
  const showOrbits = useSettingsStore((s) => s.showOrbits);
  const orbitScope = useSettingsStore((s) => s.orbitScope);
  if (!showOrbits) return null;
  return (
    <>
      {orbitScope === 'all' && <AllOrbitPaths />}
      <SelectedOrbitPath />
    </>
  );
}

/** Drift threshold check shared by both path kinds; returns a new center when due. */
function useRecenter(spanMs: number | null): number {
  const [centerMs, setCenterMs] = useState(() => getSimTimeMs());
  const centerRef = useRef(centerMs);
  centerRef.current = centerMs;
  useFrame(() => {
    if (spanMs === null) return;
    const now = getSimTimeMs();
    if (Math.abs(now - centerRef.current) > spanMs * REGENERATE_DRIFT_FRACTION) setCenterMs(now);
  });
  return centerMs;
}

function SelectedOrbitPath() {
  const record = useSatelliteStore(selectSelectedSatellite);
  const periods = useSettingsStore((s) => s.orbitLengthPeriods);
  const satrec = useMemo(() => {
    if (!record) return null;
    try {
      return satrecFor(record.tle);
    } catch {
      return null;
    }
  }, [record]);
  const periodMin = satrec ? orbitalPeriodMin(satrec) : null;
  const centerMs = useRecenter(periodMin === null ? null : periodMin * 60_000 * periods);

  const line = useMemo(() => {
    if (!satrec || !record || periodMin === null) return null;
    const window: OrbitWindow = { centerMs, periods, trailFraction: ORBIT_TRAIL_FRACTION };
    const { startMs, endMs } = orbitWindowBounds(periodMin, window);
    const stepMs = (periodMin * 60_000) / SELECTED_SAMPLES_PER_PERIOD;
    const samples = sampleTrajectory(satrec, startMs, endMs, stepMs);
    if (samples.length < 2) return null;
    const base = new Color(CATEGORY_COLORS[record.category]);
    const past = base.clone().multiplyScalar(0.35);
    const points: [number, number, number][] = [];
    const colors: [number, number, number][] = [];
    for (const s of samples) {
      const p: [number, number, number] = [0, 0, 0];
      writeSceneFromKm(s.teme.positionKm.x, s.teme.positionKm.y, s.teme.positionKm.z, p);
      points.push(p);
      const c = s.timeMs <= centerMs ? past : base;
      colors.push([c.r, c.g, c.b]);
    }
    return { points, colors };
  }, [satrec, record, periodMin, periods, centerMs]);

  if (!line) return null;
  return <Line points={line.points} vertexColors={line.colors} lineWidth={1.8} transparent opacity={0.95} depthWrite={false} />;
}

/** Points per period for "all" orbits, reduced for big catalogs to bound work. */
function allSamplesPerPeriod(count: number, periods: number): number {
  const budget = 400_000; // total samples per regeneration
  return Math.max(24, Math.min(90, Math.floor(budget / Math.max(1, count * periods))));
}

/**
 * Faint orbit paths for every visible object in one `LineSegments` draw call.
 * Sampled by the propagation worker (`sampleOrbitsPacked`), so even thousands
 * of paths never block rendering.
 */
function AllOrbitPaths() {
  const visible = useSatelliteStore((s) => s.visible);
  const periods = useSettingsStore((s) => s.orbitLengthPeriods);
  const { propagator } = useGlobeContext();
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const req = useRef<{ inFlight: boolean; key: string; centerMs: number }>({ inFlight: false, key: '', centerMs: NaN });

  const material = useMemo(
    () => new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false }),
    [],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);

  // Shortest period in the set decides how often the window must move.
  const minPeriodMin = useMemo(() => {
    let m = Infinity;
    for (const r of visible) m = Math.min(m, r.tle.periodMin);
    return m;
  }, [visible]);

  useFrame(() => {
    const r = req.current;
    if (r.inFlight || visible.length === 0) return;
    const now = getSimTimeMs();
    const key = `${propagator.setVersion}:${periods}`;
    const drift = Math.abs(now - r.centerMs) > minPeriodMin * 60_000 * periods * REGENERATE_DRIFT_FRACTION;
    if (key === r.key && !drift) return;
    r.inFlight = true;
    const records = visible;
    void propagator
      .sampleOrbits({ centerMs: now, periods, trailFraction: ORBIT_TRAIL_FRACTION }, allSamplesPerPeriod(records.length, periods))
      .then((res) => {
        r.inFlight = false;
        if (!res || res.counts.length !== records.length) return;
        r.key = key;
        r.centerMs = now;
        setGeometry(buildSegments(res.positionsKm, res.counts, records));
      });
  });

  if (!geometry) return null;
  return <lineSegments geometry={geometry} material={material} frustumCulled={false} />;
}

function buildSegments(positionsKm: Float32Array, counts: Uint32Array, records: SatelliteRecord[]): BufferGeometry {
  const nPoints = positionsKm.length / 3;
  const pos = new Float32Array(nPoints * 3);
  const col = new Float32Array(nPoints * 3);
  let nSeg = 0;
  for (const c of counts) nSeg += Math.max(0, c - 1);
  const index = new Uint32Array(nSeg * 2);
  const color = new Color();
  let p = 0;
  let k = 0;
  counts.forEach((count, i) => {
    color.set(CATEGORY_COLORS[records[i]!.category]);
    for (let j = 0; j < count; j++) {
      const o = (p + j) * 3;
      writeSceneFromKm(positionsKm[o]!, positionsKm[o + 1]!, positionsKm[o + 2]!, pos, o);
      col[o] = color.r;
      col[o + 1] = color.g;
      col[o + 2] = color.b;
      if (j > 0) {
        index[k++] = p + j - 1;
        index[k++] = p + j;
      }
    }
    p += count;
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}
