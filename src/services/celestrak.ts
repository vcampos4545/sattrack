/**
 * CelesTrak GP data client.
 *
 * Endpoint: https://celestrak.org/NORAD/elements/gp.php (public, no API key,
 * sends `Access-Control-Allow-Origin: *`, so the browser can call it
 * directly). We request `FORMAT=tle` (three-line sets) because TLE parsing is
 * explicit and testable here; OMM JSON (`FORMAT=json`) is the long-term
 * format once catalog numbers exceed the Alpha-5 range, and
 * `satellite.js`'s `json2satrec` already supports it.
 *
 * Usage policy: CelesTrak regenerates GP data about every 2 hours and asks
 * clients not to download the same data more often; repeated downloads can
 * get an IP blocked. `CELESTRAK_MIN_REFETCH_MS` enforces that floor even for
 * manual refreshes.
 */
import type { CatalogGroupId, SatelliteCategory } from '../types/satellite';

export const CELESTRAK_GP_URL = 'https://celestrak.org/NORAD/elements/gp.php';
export const CELESTRAK_MIN_REFETCH_MS = 2 * 60 * 60 * 1000;

export interface CatalogGroupDefinition {
  id: CatalogGroupId;
  label: string;
  /** Value of CelesTrak's `GROUP` query parameter. */
  celestrakGroup: string;
  category: SatelliteCategory;
  /** Loaded on first launch. Large groups are opt-in. */
  defaultEnabled: boolean;
  /** Rough object count, for warning users before enabling a large group. */
  approxCount: number;
}

export const CATALOG_GROUPS: readonly CatalogGroupDefinition[] = [
  { id: 'stations', label: 'Space stations', celestrakGroup: 'stations', category: 'stations', defaultEnabled: true, approxCount: 30 },
  { id: 'weather', label: 'Weather', celestrakGroup: 'weather', category: 'weather', defaultEnabled: true, approxCount: 70 },
  { id: 'gps-ops', label: 'GPS operational', celestrakGroup: 'gps-ops', category: 'gnss', defaultEnabled: true, approxCount: 32 },
  { id: 'amateur', label: 'Amateur radio', celestrakGroup: 'amateur', category: 'amateur', defaultEnabled: true, approxCount: 100 },
  { id: 'science', label: 'Science', celestrakGroup: 'science', category: 'science', defaultEnabled: true, approxCount: 60 },
  { id: 'starlink', label: 'Starlink', celestrakGroup: 'starlink', category: 'starlink', defaultEnabled: false, approxCount: 9000 },
  { id: 'active', label: 'All active satellites', celestrakGroup: 'active', category: 'active', defaultEnabled: false, approxCount: 13000 },
];

export const DEFAULT_GROUP_IDS: CatalogGroupId[] = CATALOG_GROUPS.filter((g) => g.defaultEnabled).map((g) => g.id);

export function getGroupDefinition(id: CatalogGroupId): CatalogGroupDefinition {
  const def = CATALOG_GROUPS.find((g) => g.id === id);
  if (!def) throw new Error(`Unknown catalog group: ${id}`);
  return def;
}

export function groupUrl(id: CatalogGroupId): string {
  return `${CELESTRAK_GP_URL}?GROUP=${encodeURIComponent(getGroupDefinition(id).celestrakGroup)}&FORMAT=tle`;
}

export function catalogNumberUrl(noradId: number): string {
  if (!Number.isInteger(noradId) || noradId <= 0) throw new Error(`Invalid NORAD id: ${noradId}`);
  return `${CELESTRAK_GP_URL}?CATNR=${noradId}&FORMAT=tle`;
}

export type CelestrakErrorKind = 'network' | 'http' | 'timeout' | 'empty';

export class CelestrakError extends Error {
  readonly kind: CelestrakErrorKind;
  readonly status?: number;
  constructor(kind: CelestrakErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'CelestrakError';
    this.kind = kind;
    this.status = status;
  }
}

export interface FetchTleOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Downloads TLE text. Throws `CelestrakError` for network failures, timeouts,
 * non-2xx responses (403 usually means the rate limit was hit) and CelesTrak's
 * 200 "No GP data found" body.
 */
export async function fetchTleText(url: string, opts: FetchTleOptions = {}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted && !opts.signal?.aborted) {
      throw new CelestrakError('timeout', `CelesTrak request timed out: ${url}`);
    }
    throw new CelestrakError('network', `CelesTrak unreachable: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
  if (!response.ok) {
    const hint = response.status === 403 ? ' (CelesTrak may be rate limiting this client)' : '';
    throw new CelestrakError('http', `CelesTrak returned HTTP ${response.status}${hint}`, response.status);
  }
  const text = await response.text();
  if (text.trim() === '' || /no gp data found/i.test(text)) {
    throw new CelestrakError('empty', 'CelesTrak returned no GP data');
  }
  return text;
}
