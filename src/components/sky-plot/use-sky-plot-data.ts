import { useMemo } from 'react';
import { currentOrNextPass, type PassSearchStatus } from '../../core/orbit/pass-prediction';
import { satrecFor, type SatRec } from '../../core/orbit/sgp4';
import { lookAnglesFast, sampleSkyTrack } from '../../core/orbit/sky-track';
import { usePassPredictions, useSelectedPass } from '../../hooks/use-pass-predictions';
import type { LookAngles } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';
import type { Pass, PassTrackSample } from '../../types/passes';
import type { SatelliteRecord } from '../../types/satellite';

const MINUTE = 60_000;
/** Samples across the live past + predicted window. */
const LIVE_WINDOW_SAMPLES = 240;

export interface SkyPlotInputs {
  record: SatelliteRecord | null;
  observer: ObserverLocation;
  timeMs: number;
}

/** Which pass the plot is annotating with AOS / max / LOS, and why. */
export type FocusKind = 'selected' | 'in-progress' | 'next';

export interface SkyPlotData {
  /** Look angles of the selected object at `timeMs`, or null. */
  current: LookAngles | null;
  /** Samples from the past half of the live window up to now. */
  past: PassTrackSample[];
  /** Samples from now through the predicted half of the live window. */
  future: PassTrackSample[];
  /** Pass annotated with AOS / max / LOS. */
  focus: Pass | null;
  focusKind: FocusKind | null;
  /** Why there is no pass to annotate, when the pass search says so. */
  passStatus: Exclude<PassSearchStatus, 'ok'> | 'computing' | null;
  /** End of the pass search window, UTC ms. */
  windowEndMs: number;
  error: string | null;
}

const EMPTY: SkyPlotData = {
  current: null,
  past: [],
  future: [],
  focus: null,
  focusKind: null,
  passStatus: null,
  windowEndMs: 0,
  error: null,
};

/**
 * Half-width of the live past/predicted window: a quarter orbit, clamped to
 * 10-60 min. A quarter of a LEO orbit (~23 min for the ISS) spans a full
 * horizon-to-horizon pass; slower orbits are capped so the window stays local.
 */
function liveHalfWindowMs(satrec: SatRec): number {
  const periodMin = (2 * Math.PI) / satrec.no;
  return Math.min(60, Math.max(10, periodMin / 4)) * MINUTE;
}

/**
 * Everything the sky plot draws. Look angles come from
 * `core/orbit/sky-track.ts`; passes come from the shared pass store
 * (`core/orbit/pass-prediction.ts` via the pass scheduler), the same
 * predictions the passes table shows.
 */
export function useSkyPlotData({ record, observer, timeMs }: SkyPlotInputs): SkyPlotData {
  const passStore = usePassPredictions();
  const selectedPass = useSelectedPass();

  const satrec = useMemo(() => {
    if (!record) return { satrec: null, error: null };
    try {
      return { satrec: satrecFor(record.tle), error: null };
    } catch (err) {
      return { satrec: null, error: (err as Error).message };
    }
  }, [record]);

  // Live window, re-sampled only when time crosses a sample boundary so the
  // samples stay on a fixed grid between ticks.
  const halfWindowMs = satrec.satrec ? liveHalfWindowMs(satrec.satrec) : MINUTE;
  const stepMs = Math.max(1000, Math.round((2 * halfWindowMs) / LIVE_WINDOW_SAMPLES));
  const gridMs = Math.floor(timeMs / stepMs) * stepMs;
  const liveTrack = useMemo(() => {
    if (!satrec.satrec) return [];
    return sampleSkyTrack(satrec.satrec, observer, gridMs - halfWindowMs, gridMs + halfWindowMs + stepMs, stepMs);
  }, [satrec, observer, gridMs, halfWindowMs, stepMs]);

  const current = useMemo(
    () => (satrec.satrec ? lookAnglesFast(satrec.satrec, observer, timeMs) : null),
    [satrec, observer, timeMs],
  );

  // Only trust store passes computed for this object. In Tracked-only mode
  // the store holds one result per Tracked-list satellite.
  const result = record ? (passStore.results.get(record.noradId) ?? null) : null;
  const passes = result?.passes ?? null;
  // Tracked-only mode with an object that is not on the list: no prediction is coming.
  const expectResult = passStore.mode === 'selected' || passStore.pendingCount > 0;

  return useMemo(() => {
    if (!record) return EMPTY;
    if (!satrec.satrec) return { ...EMPTY, error: satrec.error ?? 'No orbit for this object' };
    if (!current) return { ...EMPTY, error: 'SGP4 could not propagate this element set (decayed?)' };

    const now: PassTrackSample = { timeMs, ...current };
    const past = [...liveTrack.filter((s) => s.timeMs < timeMs), now];
    const future = [now, ...liveTrack.filter((s) => s.timeMs > timeMs)];

    let focus: Pass | null = null;
    let focusKind: FocusKind | null = null;
    if (selectedPass && selectedPass.noradId === record.noradId) {
      focus = selectedPass;
      focusKind = 'selected';
    } else if (passes) {
      focus = currentOrNextPass(passes, timeMs);
      if (focus) focusKind = focus.aosMs <= timeMs ? 'in-progress' : 'next';
    }

    let passStatus: SkyPlotData['passStatus'] = null;
    if (!focus) {
      if (!result) passStatus = expectResult ? 'computing' : null;
      else if (result.status !== 'ok') passStatus = result.status;
    }
    return {
      current,
      past,
      future,
      focus,
      focusKind,
      passStatus,
      windowEndMs: result?.windowEndMs ?? 0,
      error: null,
    };
  }, [record, satrec, current, liveTrack, timeMs, selectedPass, passes, result, expectResult]);
}
