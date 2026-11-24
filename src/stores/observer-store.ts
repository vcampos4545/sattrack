/**
 * Observer (ground station) location, persisted to localStorage.
 *
 * Until the user sets a location, a default is used and flagged with
 * `source: 'default'` so the UI can prompt for a real one.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { validateObserverLocation } from '../core/orbit/observer';
import { PERSIST_KEYS, safeLocalStorage } from '../services/storage';
import type { ObserverLocation, ObserverValidationErrors } from '../types/observer';

/** Royal Observatory Greenwich: the prime meridian, a neutral default. */
export const DEFAULT_OBSERVER: ObserverLocation = {
  latitudeDeg: 51.4769,
  longitudeDeg: -0.0005,
  altitudeM: 46,
  label: 'Greenwich (default)',
  source: 'default',
};

export interface ObserverState {
  location: ObserverLocation;
  /** Validates, then stores. Returns field errors and leaves state unchanged if invalid. */
  setLocation(next: ObserverLocation): ObserverValidationErrors;
  resetLocation(): void;
}

export const useObserverStore = create<ObserverState>()(
  persist(
    (set) => ({
      location: DEFAULT_OBSERVER,
      setLocation: (next) => {
        const errors = validateObserverLocation(next);
        if (Object.keys(errors).length === 0) set({ location: { ...next } });
        return errors;
      },
      resetLocation: () => set({ location: DEFAULT_OBSERVER }),
    }),
    {
      name: PERSIST_KEYS.observer,
      version: 1,
      storage: createJSONStorage(safeLocalStorage),
      partialize: (s) => ({ location: s.location }),
      merge: (persisted, current) => {
        const loc = (persisted as { location?: ObserverLocation } | undefined)?.location;
        const valid = loc && Object.keys(validateObserverLocation(loc)).length === 0;
        return valid ? { ...current, location: loc } : current;
      },
    },
  ),
);
