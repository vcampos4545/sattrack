/**
 * Offline place search for the observer location panel.
 *
 * Uses a bundled extract of GeoNames (`src/data/places.json`, built by
 * `scripts/build-places.mjs`): every place with at least 100 000 inhabitants
 * plus every national capital, about 6 400 entries. No network, no API key.
 * The JSON (about 350 KB, 150 KB gzipped) is code-split and only loaded the
 * first time the user searches.
 *
 * Elevations are meters above mean sea level (GeoNames survey or DEM value).
 * `ObserverLocation.altitudeM` is height above the WGS84 ellipsoid; the two
 * differ by the geoid undulation (within about ±100 m worldwide). That changes
 * computed elevation angles by well under 0.01° for LEO and is documented
 * rather than corrected.
 */

/** Compact row as stored in places.json: [name, asciiName ('' when equal), countryCode, admin1, lat, lon, elevM]. */
export type PlaceRow = [string, string, string, string, number, number, number];

export interface PlaceData {
  source: string;
  countries: Record<string, string>;
  /** Most populous first. */
  places: PlaceRow[];
}

export interface Place {
  name: string;
  /** First-level admin division (state, province), may be empty. */
  admin: string;
  country: string;
  countryCode: string;
  latitudeDeg: number;
  longitudeDeg: number;
  /** Meters above mean sea level. */
  elevationM: number;
}

export interface PlaceIndex {
  source: string;
  entries: { place: Place; keys: string[] }[];
}

/** Lowercase, strip diacritics and punctuation so "Sao Paulo" finds "São Paulo". */
export function normalizeSearchText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function buildPlaceIndex(data: PlaceData): PlaceIndex {
  return {
    source: data.source,
    entries: data.places.map(([name, ascii, cc, admin, lat, lon, elev]) => {
      const country = data.countries[cc] ?? cc;
      const keys = [normalizeSearchText(name)];
      if (ascii) keys.push(normalizeSearchText(ascii));
      return {
        place: { name, admin, country, countryCode: cc, latitudeDeg: lat, longitudeDeg: lon, elevationM: elev },
        keys,
      };
    }),
  };
}

/**
 * Finds places whose name matches the query. A query may add a qualifier
 * after a comma ("Portland, Oregon", "Paris, FR") that must match the admin
 * division, country name or country code.
 *
 * Ranking: exact name, then name prefix, then word prefix, then substring.
 * Ties keep population order (the data is sorted most populous first).
 */
export function searchPlaces(index: PlaceIndex, query: string, limit = 8): Place[] {
  const [rawName, ...rest] = query.split(',');
  const q = normalizeSearchText(rawName ?? '');
  const qualifier = normalizeSearchText(rest.join(' '));
  if (q.length < 2) return [];

  const buckets: Place[][] = [[], [], [], []];
  for (const { place, keys } of index.entries) {
    let rank = 4;
    for (const k of keys) {
      if (k === q) rank = Math.min(rank, 0);
      else if (k.startsWith(q)) rank = Math.min(rank, 1);
      else if (k.includes(` ${q}`)) rank = Math.min(rank, 2);
      else if (k.includes(q)) rank = Math.min(rank, 3);
    }
    if (rank === 4) continue;
    if (qualifier && !matchesQualifier(place, qualifier)) continue;
    buckets[rank]?.push(place);
    if (rank === 0 && (buckets[0]?.length ?? 0) >= limit) break;
  }
  return buckets.flat().slice(0, limit);
}

function matchesQualifier(place: Place, qualifier: string): boolean {
  if (normalizeSearchText(place.countryCode) === qualifier) return true;
  return [place.admin, place.country].some((s) => normalizeSearchText(s).startsWith(qualifier));
}

let indexPromise: Promise<PlaceIndex> | null = null;

/** Lazily loads and indexes the bundled place list once. */
export function loadPlaceIndex(): Promise<PlaceIndex> {
  indexPromise ??= import('../data/places.json')
    .then((m) => buildPlaceIndex(m.default as unknown as PlaceData))
    .catch((e: unknown) => {
      indexPromise = null; // allow a retry
      console.error('[place-search] failed to load place list', e);
      throw e;
    });
  return indexPromise;
}

/** "Portland, Oregon, United States" */
export function formatPlaceLabel(p: Place): string {
  return [p.name, p.admin && p.admin !== p.name ? p.admin : '', p.country].filter(Boolean).join(', ');
}

/**
 * Nearest indexed place within `maxKm` of a point, by great-circle distance on
 * a sphere of mean Earth radius (good to about 0.5%, ample for naming a fix).
 */
export function nearestPlace(
  index: PlaceIndex,
  latitudeDeg: number,
  longitudeDeg: number,
  maxKm = 30,
): { place: Place; distanceKm: number } | null {
  const R = 6371.0088;
  const rad = Math.PI / 180;
  const lat1 = latitudeDeg * rad;
  let best: { place: Place; distanceKm: number } | null = null;
  for (const { place } of index.entries) {
    const lat2 = place.latitudeDeg * rad;
    const dLat = lat2 - lat1;
    const dLon = (place.longitudeDeg - longitudeDeg) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const d = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    if (d <= maxKm && (!best || d < best.distanceKm)) best = { place, distanceKm: d };
  }
  return best;
}
