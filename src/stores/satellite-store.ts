/**
 * Satellite catalog, tracked set, category filters and selection.
 *
 * Definitions:
 * - catalog (`satellites`): every record loaded from the enabled CelesTrak
 *   groups plus individually added NORAD ids.
 * - tracked (`tracked`): catalog minus objects the user removed.
 * - visible (`visible`): tracked objects whose category filter is on. This is
 *   what the globe should draw and propagate.
 *
 * `tracked` and `visible` are recomputed inside actions (not in selectors) so
 * that components get stable array references and only re-render when the
 * set actually changes.
 *
 * Positions are NOT stored here. Propagated state lives outside React state
 * (see README, "Module contracts").
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_GROUP_IDS } from '../services/celestrak';
import {
  createSatelliteCatalog,
  type CatalogLoadResult,
  type ExtraObjectStatus,
  type SatelliteCatalog,
} from '../services/satellite-catalog';
import { getDefaultCacheStore, PERSIST_KEYS, safeLocalStorage } from '../services/storage';
import {
  CATEGORY_PRIORITY,
  type CatalogGroupId,
  type CatalogGroupStatus,
  type SatelliteCategory,
  type SatelliteRecord,
} from '../types/satellite';
import { useSettingsStore } from './settings-store';

let catalogService: SatelliteCatalog | null = null;

/** Replace the catalog service (tests, or a future Web Worker-backed implementation). */
export function setCatalogService(service: SatelliteCatalog): void {
  catalogService = service;
}

function getCatalogService(): SatelliteCatalog {
  catalogService ??= createSatelliteCatalog({ cache: getDefaultCacheStore() });
  return catalogService;
}

export type CatalogLoadState = 'idle' | 'loading' | 'ready' | 'error';

export type CategoryFilter = Record<SatelliteCategory, boolean>;

export const DEFAULT_CATEGORY_FILTER: CategoryFilter = Object.fromEntries(
  CATEGORY_PRIORITY.map((c) => [c, true]),
) as CategoryFilter;

interface PersistedSatelliteState {
  enabledGroups: CatalogGroupId[];
  extraNoradIds: number[];
  untrackedIds: number[];
  categoryFilter: CategoryFilter;
  selectedId: number | null;
}

export interface SatelliteState extends PersistedSatelliteState {
  satellites: SatelliteRecord[];
  byId: ReadonlyMap<number, SatelliteRecord>;
  tracked: SatelliteRecord[];
  visible: SatelliteRecord[];
  groupStatus: CatalogGroupStatus[];
  extraStatus: ExtraObjectStatus[];
  loadState: CatalogLoadState;
  /** Error that left the catalog empty or unusable. Per-group errors are in `groupStatus`. */
  loadError: string | null;
  /** Wall-clock ms of the last completed load. */
  lastLoadedAtMs: number | null;
  /** Selected pass of the selected satellite (`Pass.id`). Cleared when the selection changes. */
  selectedPassId: string | null;

  /** Load the catalog. Uses cache unless stale; `force` = manual refresh. */
  loadCatalog(opts?: { force?: boolean }): Promise<void>;
  setGroupEnabled(id: CatalogGroupId, enabled: boolean): void;
  /** Track an object by NORAD id. Downloads it individually if no enabled group contains it. */
  trackNoradId(noradId: number): void;
  untrack(noradId: number): void;
  setCategoryVisible(category: SatelliteCategory, visible: boolean): void;
  select(noradId: number | null): void;
  selectPass(passId: string | null): void;
}

function derive(
  satellites: SatelliteRecord[],
  untrackedIds: number[],
  categoryFilter: CategoryFilter,
): Pick<SatelliteState, 'tracked' | 'visible'> {
  const untracked = new Set(untrackedIds);
  const tracked = satellites.filter((s) => !untracked.has(s.noradId));
  const visible = tracked.filter((s) => categoryFilter[s.category]);
  return { tracked, visible };
}

let loadSeq = 0;

export const useSatelliteStore = create<SatelliteState>()(
  persist(
    (set, get) => ({
      enabledGroups: [...DEFAULT_GROUP_IDS],
      extraNoradIds: [],
      untrackedIds: [],
      categoryFilter: { ...DEFAULT_CATEGORY_FILTER },
      selectedId: null,
      selectedPassId: null,

      satellites: [],
      byId: new Map(),
      tracked: [],
      visible: [],
      groupStatus: [],
      extraStatus: [],
      loadState: 'idle',
      loadError: null,
      lastLoadedAtMs: null,

      loadCatalog: async ({ force = false } = {}) => {
        const seq = ++loadSeq;
        const { enabledGroups, extraNoradIds } = get();
        set({ loadState: 'loading' });
        let result: CatalogLoadResult;
        try {
          result = await getCatalogService().load({
            groups: enabledGroups,
            extraNoradIds,
            force,
            maxAgeMs: useSettingsStore.getState().autoRefreshHours * 3_600_000,
          });
        } catch (err) {
          if (seq !== loadSeq) return;
          console.error('[catalog] load failed', err);
          set({ loadState: 'error', loadError: (err as Error).message });
          return;
        }
        // A newer load (e.g. group toggled mid-flight) supersedes this one.
        if (seq !== loadSeq) return;
        const { untrackedIds, categoryFilter, selectedId } = get();
        const byId = new Map(result.satellites.map((s) => [s.noradId, s]));
        const empty = result.satellites.length === 0;
        set({
          satellites: result.satellites,
          byId,
          ...derive(result.satellites, untrackedIds, categoryFilter),
          groupStatus: result.groupStatus,
          extraStatus: result.extraStatus,
          lastLoadedAtMs: result.loadedAtMs,
          loadState: empty ? 'error' : 'ready',
          loadError: empty ? 'No satellite data available (offline with no cached data?)' : null,
          // Keep the selection only if the object is still in the catalog.
          ...(selectedId !== null && !byId.has(selectedId) ? { selectedId: null, selectedPassId: null } : {}),
        });
      },

      setGroupEnabled: (id, enabled) => {
        const groups = new Set(get().enabledGroups);
        if (enabled) groups.add(id);
        else groups.delete(id);
        set({ enabledGroups: [...groups] });
        void get().loadCatalog();
      },

      trackNoradId: (noradId) => {
        if (!Number.isInteger(noradId) || noradId <= 0) return;
        const s = get();
        const untrackedIds = s.untrackedIds.filter((id) => id !== noradId);
        const needsDownload = !s.byId.has(noradId) && !s.extraNoradIds.includes(noradId);
        set({
          untrackedIds,
          extraNoradIds: needsDownload ? [...s.extraNoradIds, noradId] : s.extraNoradIds,
          ...derive(s.satellites, untrackedIds, s.categoryFilter),
        });
        if (needsDownload) void get().loadCatalog();
      },

      untrack: (noradId) => {
        const s = get();
        const untrackedIds = s.untrackedIds.includes(noradId) ? s.untrackedIds : [...s.untrackedIds, noradId];
        set({
          untrackedIds,
          // Individually added objects are dropped entirely.
          extraNoradIds: s.extraNoradIds.filter((id) => id !== noradId),
          ...derive(s.satellites, untrackedIds, s.categoryFilter),
          ...(s.selectedId === noradId ? { selectedId: null, selectedPassId: null } : {}),
        });
      },

      setCategoryVisible: (category, visible) => {
        const s = get();
        const categoryFilter = { ...s.categoryFilter, [category]: visible };
        set({ categoryFilter, ...derive(s.satellites, s.untrackedIds, categoryFilter) });
      },

      select: (noradId) => {
        if (noradId === get().selectedId) return;
        set({ selectedId: noradId, selectedPassId: null });
      },

      selectPass: (passId) => set({ selectedPassId: passId }),
    }),
    {
      name: PERSIST_KEYS.satellites,
      version: 1,
      storage: createJSONStorage(safeLocalStorage),
      partialize: (s): PersistedSatelliteState => ({
        enabledGroups: s.enabledGroups,
        extraNoradIds: s.extraNoradIds,
        untrackedIds: s.untrackedIds,
        categoryFilter: s.categoryFilter,
        selectedId: s.selectedId,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedSatelliteState>;
        return {
          ...current,
          ...p,
          categoryFilter: { ...DEFAULT_CATEGORY_FILTER, ...p.categoryFilter },
        };
      },
    },
  ),
);

/** The selected satellite record, or null. */
export const selectSelectedSatellite = (s: SatelliteState): SatelliteRecord | null =>
  s.selectedId === null ? null : (s.byId.get(s.selectedId) ?? null);
