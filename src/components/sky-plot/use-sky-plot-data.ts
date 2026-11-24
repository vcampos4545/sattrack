import { useMemo, useRef } from 'react';
import { satrecFor, type SatRec } from '../../core/orbit/sgp4';
import { findSkyArc, lookAnglesFast, parsePassId, sampleSkyTrack } from '../../core/orbit/sky-track';
import type { LookAngles } from '../../types/orbital';
import type { ObserverLocation } from '../../types/observer';
import type { Pass, PassTrackSample } from '../../types/passes';
import type { SatelliteRecord } from '../../types/satellite';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Samples across the live past + predicted window. */
const LIVE_WINDOW_SAMPLES = 240;
/** When no arc was found, look again after this much simulation time. */
const NO_ARC_RECHECK_MS = 60 * MINUTE;

export interface SkyPlotInputs {
  record: SatelliteRecord | null;
  observer: ObserverLocation;
  timeMs: number;
  maskDeg: number;
  selectedPassId: string | null;
  passSearchDays: number;
  passScanStepS: number;
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
  /** True when no arc above the mask was found in the search window. */
  noArcInWindow: boolean;
  searchEndMs: number;
  error: string | null;
}

const EMPTY: SkyPlotData = {
  current: null,
  past: [],
  future: [],
  focus: null,
  focusKind: null,
  noArcInWindow: false,
  searchEndMs: 0,
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

interface ArcCacheEntry {
  key: string;
  validFromMs: number;
  validUntilMs: number;
  pass: Pass | null;
  searchEndMs: number;
}

/**
 * Everything the sky plot draws, computed from the orbit core. No orbital
 * math happens here beyond choosing time windows; all look angles come from
 * `core/orbit/sky-track.ts`.
 */
export function useSkyPlotData(inputs: SkyPlotInputs): SkyPlotData {
  const { record, observer, timeMs, maskDeg, selectedPassId, passSearchDays, passScanStepS } = inputs;

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

  // A pass picked in the passes table, found again from its id.
  const selected = useMemo(() => {
    if (!satrec.satrec || !record || !selectedPassId) return null;
    const parsed = parsePassId(selectedPassId);
    if (!parsed || parsed.noradId !== record.noradId) return null;
    // Start a little before the table's AOS; a pass that was in progress at
    // the table's search start is refined back to its real rise.
    return findSkyArc(satrec.satrec, observer, record.noradId, parsed.aosMs - MINUTE, {
      maskDeg,
      searchMs: 3 * 3_600_000,
      scanStepMs: 10_000,
    });
  }, [satrec, record, observer, maskDeg, selectedPassId]);

  // Current or next arc. Searching days ahead is the expensive part, so the
  // result is reused while simulation time stays inside the interval it is
  // valid for: no other arc can start between the search start and its AOS,
  // and it stays the current arc until its LOS. A cache, not React state:
  // writing it during render is idempotent.
  const arcCache = useRef<ArcCacheEntry | null>(null);
  let arc: ArcCacheEntry | null = null;
  if (satrec.satrec && record) {
    const key = [
      record.noradId,
      record.tle.epochMs,
      record.tle.line2,
      observer.latitudeDeg,
      observer.longitudeDeg,
      observer.altitudeM,
      maskDeg,
      passSearchDays,
      passScanStepS,
    ].join('|');
    const cached = arcCache.current;
    if (cached && cached.key === key && timeMs >= cached.validFromMs && timeMs <= cached.validUntilMs) {
      arc = cached;
    } else {
      const searchMs = passSearchDays * DAY;
      const pass = findSkyArc(satrec.satrec, observer, record.noradId, timeMs, {
        maskDeg,
        searchMs,
        scanStepMs: passScanStepS * 1000,
      });
      arc = {
        key,
        validFromMs: pass ? Math.min(pass.aosMs, timeMs) : timeMs,
        validUntilMs: pass ? pass.losMs : timeMs + NO_ARC_RECHECK_MS,
        pass,
        searchEndMs: timeMs + searchMs,
      };
      arcCache.current = arc;
    }
  }

  return useMemo(() => {
    if (!record) return EMPTY;
    if (!satrec.satrec) return { ...EMPTY, error: satrec.error ?? 'No orbit for this object' };
    if (!current) return { ...EMPTY, error: 'SGP4 could not propagate this element set (decayed?)' };

    const now: PassTrackSample = { timeMs, ...current };
    const past = [...liveTrack.filter((s) => s.timeMs < timeMs), now];
    const future = [now, ...liveTrack.filter((s) => s.timeMs > timeMs)];

    let focus: Pass | null = null;
    let focusKind: FocusKind | null = null;
    if (selected) {
      focus = selected;
      focusKind = 'selected';
    } else if (arc?.pass) {
      focus = arc.pass;
      focusKind = arc.pass.aosMs <= timeMs ? 'in-progress' : 'next';
    }
    return {
      current,
      past,
      future,
      focus,
      focusKind,
      noArcInWindow: !selected && !arc?.pass,
      searchEndMs: arc?.searchEndMs ?? 0,
      error: null,
    };
  }, [record, satrec, current, liveTrack, timeMs, selected, arc]);
}
