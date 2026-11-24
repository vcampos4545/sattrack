/**
 * View state local to the primary globe: hover and camera focus requests.
 * Kept out of the shared stores because no other panel needs it.
 */
import { create } from 'zustand';

export type FocusTarget = 'selected' | 'observer';

interface GlobeViewState {
  /** NORAD id under the cursor, or null. */
  hoveredId: number | null;
  /** Camera focus request; `seq` increments on every request so repeats re-trigger. */
  focus: { target: FocusTarget; seq: number } | null;
  setHovered(id: number | null): void;
  requestFocus(target: FocusTarget): void;
}

export const useGlobeViewStore = create<GlobeViewState>()((set, get) => ({
  hoveredId: null,
  focus: null,
  setHovered: (id) => {
    if (get().hoveredId !== id) set({ hoveredId: id });
  },
  requestFocus: (target) => set({ focus: { target, seq: (get().focus?.seq ?? 0) + 1 } }),
}));
