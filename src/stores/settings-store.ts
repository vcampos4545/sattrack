/**
 * User preferences, persisted to localStorage.
 * Angles in degrees, durations in the unit named by the field.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { PERSIST_KEYS, safeLocalStorage } from '../services/storage';

export type OrbitScope = 'selected' | 'all';

export interface Settings {
  /** Minimum elevation for passes (AOS/LOS) and the sky-plot mask, degrees. */
  elevationMaskDeg: number;
  /** Minimum ground elevation angle used for the coverage footprint, degrees. 0 = geometric horizon. */
  footprintMinElevationDeg: number;
  /** Number of upcoming passes to predict. */
  passCount: number;
  /** How far ahead to search for passes, days. */
  passSearchDays: number;
  /** Coarse scan step for pass search before AOS/LOS/max refinement, seconds. */
  passScanStepS: number;
  showOrbits: boolean;
  orbitScope: OrbitScope;
  /** Length of drawn orbit paths, in orbital periods. */
  orbitLengthPeriods: number;
  showLatLonGrid: boolean;
  showTerminator: boolean;
  /** Bulk satellite propagation frequency, Hz. Independent of the render frame rate. */
  propagationHz: number;
  /** Re-download GP data when the cache is older than this, hours. Floor: 2 h (CelesTrak policy). */
  autoRefreshHours: number;
  /** Predicted ground track length on the secondary globe, orbital periods (1-3). */
  groundTrackAheadRevs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  elevationMaskDeg: 10,
  footprintMinElevationDeg: 0,
  passCount: 10,
  passSearchDays: 7,
  passScanStepS: 30,
  showOrbits: true,
  orbitScope: 'selected',
  orbitLengthPeriods: 1,
  showLatLonGrid: true,
  showTerminator: true,
  propagationHz: 1,
  autoRefreshHours: 12,
  groundTrackAheadRevs: 1,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Clamps numeric settings to sane ranges and type-checks the rest. Invalid
 * input (non-finite numbers, wrong types from a corrupted or older stored
 * copy) keeps the previous value.
 */
export function sanitizeSettings(next: Settings, prev: Settings = DEFAULT_SETTINGS): Settings {
  const num = (key: keyof Settings, lo: number, hi: number) => {
    const v = next[key] as number;
    return Number.isFinite(v) ? clamp(v, lo, hi) : (prev[key] as number);
  };
  const bool = (key: 'showOrbits' | 'showLatLonGrid' | 'showTerminator') =>
    typeof next[key] === 'boolean' ? next[key] : prev[key];
  return {
    ...next,
    elevationMaskDeg: num('elevationMaskDeg', 0, 89),
    footprintMinElevationDeg: num('footprintMinElevationDeg', 0, 89),
    passCount: Math.round(num('passCount', 1, 50)),
    passSearchDays: num('passSearchDays', 0.25, 30),
    passScanStepS: num('passScanStepS', 1, 300),
    orbitLengthPeriods: num('orbitLengthPeriods', 0.1, 10),
    propagationHz: num('propagationHz', 0.1, 30),
    autoRefreshHours: num('autoRefreshHours', 2, 24 * 7),
    groundTrackAheadRevs: Math.round(num('groundTrackAheadRevs', 1, 3)),
    showOrbits: bool('showOrbits'),
    showLatLonGrid: bool('showLatLonGrid'),
    showTerminator: bool('showTerminator'),
    orbitScope: next.orbitScope === 'all' || next.orbitScope === 'selected' ? next.orbitScope : prev.orbitScope,
  };
}

export interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void;
  reset(): void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(sanitizeSettings({ ...pickSettings(get()), ...patch }, pickSettings(get()))),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: PERSIST_KEYS.settings,
      version: 1,
      storage: createJSONStorage(safeLocalStorage),
      partialize: (s) => pickSettings(s),
      // Ignore unknown/invalid stored values rather than trusting them.
      merge: (persisted, current) => ({
        ...current,
        ...sanitizeSettings({ ...DEFAULT_SETTINGS, ...(persisted as Partial<Settings>) }),
      }),
    },
  ),
);

export function pickSettings(s: Settings): Settings {
  const out = {} as Settings;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    (out as unknown as Record<string, unknown>)[key] = s[key];
  }
  return out;
}
