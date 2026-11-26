/**
 * Satellite catalog, Tracked list, filters and selection.
 *
 * Definitions:
 * - catalog (`satellites`): every record loaded from the enabled CelesTrak
 *   groups plus individually added NORAD ids.
 * - active (`active`): catalog minus objects the user removed (`removedIds`).
 * - Tracked list (`trackedIds`, records in `trackedRecords`): the objects the
 *   user curated to follow. Independent of the category filter; persisted.
 * - visible (`visible`): active objects whose category filter is on and, when
 *   `trackedOnly` is set, that are on the Tracked list. This is what the globe
 *   should draw and propagate.
 *
 * `active`, `trackedRecords` and `visible` are recomputed inside actions (not
 * in selectors) so that components get stable array references and only
 * re-render when the set actually changes.
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
  /** Objects the user removed from the loaded groups. */
  removedIds: number[];
  categoryFilter: CategoryFilter;
  /** Tracked list, in the order the user added objects. */
  trackedIds: number[];
  /** Show only Tracked-list objects on the globe, and their combined pass schedule. */
  trackedOnly: boolean;
  selectedId: number | null;
}

export interface SatelliteState extends PersistedSatelliteState {
  satellites: SatelliteRecord[];
  byId: ReadonlyMap<number, SatelliteRecord>;
  active: SatelliteRecord[];
  /** Loaded records of `trackedIds`, in list order. Ids not in the catalog are skipped. */
  trackedRecords: SatelliteRecord[];
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
  /**
   * Add an object to the catalog by NORAD id (restoring it if it was removed).
   * Downloads it individually if no enabled group contains it.
   */
  addNoradId(noradId: number): void;
  /** Remove an object from the catalog (and from the Tracked list). */
  removeObject(noradId: number): void;
  /** Bring back every object the user removed from its groups. */
  restoreRemoved(): void;
  /** Add an object to the Tracked list. Also adds it to the catalog (see `addNoradId`). */
  addTracked(noradId: number): void;
  removeTracked(noradId: number): void;
  setTrackedOnly(on: boolean): void;
  setCategoryVisible(category: SatelliteCategory, visible: boolean): void;
  select(noradId: number | null): void;
  selectPass(passId: string | null): void;
  /** Select a satellite and one of its passes together (rows of the combined schedule). */
  selectSatellitePass(noradId: number, passId: string): void;
}

type DeriveInputs = Pick<SatelliteState, 'satellites' | 'byId' | 'removedIds' | 'categoryFilter' | 'trackedIds' | 'trackedOnly'>;

/** Recomputes the derived sets. Pass the current state merged with the change. */
export function derive(s: DeriveInputs): Pick<SatelliteState, 'active' | 'trackedRecords' | 'visible'> {
  const removed = new Set(s.removedIds);
  const active = s.satellites.filter((r) => !removed.has(r.noradId));
  const trackedRecords = s.trackedIds.flatMap((id) => {
    const r = s.byId.get(id);
    return r && !removed.has(id) ? [r] : [];
  });
  const trackedSet = new Set(s.trackedIds);
  const visible = active.filter((r) => s.categoryFilter[r.category] && (!s.trackedOnly || trackedSet.has(r.noradId)));
  return { active, trackedRecords, visible };
}

/** Persisted state written by version 1 (before the Tracked list). */
interface PersistedV1 {
  untrackedIds?: number[];
}

/** Upgrades persisted state from older versions. Exported for tests. */
export function migrateSatellitePersist(persisted: unknown, version: number): Partial<PersistedSatelliteState> {
  const p = { ...((persisted ?? {}) as Partial<PersistedSatelliteState> & PersistedV1) };
  if (version < 2) {
    // v1 called removed objects "untracked"; "tracked" now means the user's Tracked list.
    p.removedIds = p.untrackedIds ?? [];
    delete p.untrackedIds;
    p.trackedIds = [];
    p.trackedOnly = false;
  }
  return p;
}

let loadSeq = 0;

export const useSatelliteStore = create<SatelliteState>()(
  persist(
    (set, get) => ({
      enabledGroups: [...DEFAULT_GROUP_IDS],
      extraNoradIds: [],
      removedIds: [],
      categoryFilter: { ...DEFAULT_CATEGORY_FILTER },
      trackedIds: [],
      trackedOnly: false,
      selectedId: null,
      selectedPassId: null,

      satellites: [],
      byId: new Map(),
      active: [],
      trackedRecords: [],
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
        const { selectedId } = get();
        const byId = new Map(result.satellites.map((s) => [s.noradId, s]));
        const empty = result.satellites.length === 0;
        set({
          satellites: result.satellites,
          byId,
          ...derive({ ...get(), satellites: result.satellites, byId }),
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

      addNoradId: (noradId) => {
        if (!Number.isInteger(noradId) || noradId <= 0) return;
        const s = get();
        const removedIds = s.removedIds.filter((id) => id !== noradId);
        const needsDownload = !s.byId.has(noradId) && !s.extraNoradIds.includes(noradId);
        set({
          removedIds,
          extraNoradIds: needsDownload ? [...s.extraNoradIds, noradId] : s.extraNoradIds,
          ...derive({ ...s, removedIds }),
        });
        if (needsDownload) void get().loadCatalog();
      },

      removeObject: (noradId) => {
        const s = get();
        const removedIds = s.removedIds.includes(noradId) ? s.removedIds : [...s.removedIds, noradId];
        const trackedIds = s.trackedIds.filter((id) => id !== noradId);
        set({
          removedIds,
          trackedIds,
          // Individually added objects are dropped entirely.
          extraNoradIds: s.extraNoradIds.filter((id) => id !== noradId),
          ...derive({ ...s, removedIds, trackedIds }),
          ...(s.selectedId === noradId ? { selectedId: null, selectedPassId: null } : {}),
        });
      },

      restoreRemoved: () => {
        const s = get();
        set({ removedIds: [], ...derive({ ...s, removedIds: [] }) });
      },

      addTracked: (noradId) => {
        if (!Number.isInteger(noradId) || noradId <= 0) return;
        get().addNoradId(noradId);
        const s = get();
        if (s.trackedIds.includes(noradId)) return;
        const trackedIds = [...s.trackedIds, noradId];
        set({ trackedIds, ...derive({ ...s, trackedIds }) });
      },

      removeTracked: (noradId) => {
        const s = get();
        if (!s.trackedIds.includes(noradId)) return;
        const trackedIds = s.trackedIds.filter((id) => id !== noradId);
        set({ trackedIds, ...derive({ ...s, trackedIds }) });
      },

      setTrackedOnly: (trackedOnly) => {
        const s = get();
        if (s.trackedOnly === trackedOnly) return;
        set({ trackedOnly, ...derive({ ...s, trackedOnly }) });
      },

      setCategoryVisible: (category, visible) => {
        const s = get();
        const categoryFilter = { ...s.categoryFilter, [category]: visible };
        set({ categoryFilter, ...derive({ ...s, categoryFilter }) });
      },

      select: (noradId) => {
        if (noradId === get().selectedId) return;
        set({ selectedId: noradId, selectedPassId: null });
      },

      selectPass: (passId) => set({ selectedPassId: passId }),

      selectSatellitePass: (noradId, passId) => set({ selectedId: noradId, selectedPassId: passId }),
    }),
    {
      name: PERSIST_KEYS.satellites,
      version: 2,
      storage: createJSONStorage(safeLocalStorage),
      migrate: (persisted, version) => migrateSatellitePersist(persisted, version) as SatelliteState,
      partialize: (s): PersistedSatelliteState => ({
        enabledGroups: s.enabledGroups,
        extraNoradIds: s.extraNoradIds,
        removedIds: s.removedIds,
        categoryFilter: s.categoryFilter,
        trackedIds: s.trackedIds,
        trackedOnly: s.trackedOnly,
        selectedId: s.selectedId,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedSatelliteState>;
        return {
          ...current,
          ...p,
          categoryFilter: { ...DEFAULT_CATEGORY_FILTER, ...p.categoryFilter },
          removedIds: Array.isArray(p.removedIds) ? p.removedIds : current.removedIds,
          trackedIds: Array.isArray(p.trackedIds) ? p.trackedIds.filter((id) => Number.isInteger(id) && id > 0) : current.trackedIds,
          trackedOnly: typeof p.trackedOnly === 'boolean' ? p.trackedOnly : current.trackedOnly,
        };
      },
    },
  ),
);

/** The selected satellite record, or null. */
export const selectSelectedSatellite = (s: SatelliteState): SatelliteRecord | null =>
  s.selectedId === null ? null : (s.byId.get(s.selectedId) ?? null);
