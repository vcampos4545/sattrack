/**
 * Catalog search by name, NORAD catalog number or international designator.
 * Pure function over the loaded records so it can be unit tested.
 */
import { CATEGORY_PRIORITY, type SatelliteRecord } from '../types/satellite';

export interface SearchHit {
  record: SatelliteRecord;
  /** Lower is better. */
  score: number;
}

/** NORAD catalog number typed as a plain integer, or null. */
export function parseNoradQuery(query: string): number | null {
  const q = query.trim().replace(/^#/, '');
  if (!/^\d{1,9}$/.test(q)) return null;
  const n = Number(q);
  return n > 0 ? n : null;
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Ranks records against the query:
 *   0 exact NORAD id, 1 NORAD id prefix or exact name, 2 name prefix,
 *   3 word prefix or international designator prefix, 4 substring,
 *   5 match ignoring spaces and punctuation ("noaa19" finds "NOAA 19").
 * Ties sort by category priority (so "iss" finds ISS (ZARYA) before its
 * modules), then shorter name, then name.
 */
export function searchSatellites(records: readonly SatelliteRecord[], query: string, limit = 50): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const id = parseNoradQuery(q);
  const idText = id === null ? null : String(id);
  const qc = compact(q);
  const hits: SearchHit[] = [];
  for (const record of records) {
    const name = record.name.toLowerCase();
    let score = Infinity;
    if (id !== null && record.noradId === id) score = 0;
    else if (idText !== null && String(record.noradId).startsWith(idText)) score = 1;
    else if (name === q) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) score = 3;
    else if (record.tle.intlDesignator && record.tle.intlDesignator.toLowerCase().startsWith(q.replace(/[-\s]/g, '')))
      score = 3;
    else if (name.includes(q)) score = 4;
    else if (qc.length >= 2 && compact(name).includes(qc)) score = 5;
    if (score !== Infinity) hits.push({ record, score });
  }
  hits.sort(
    (a, b) =>
      a.score - b.score ||
      CATEGORY_PRIORITY.indexOf(a.record.category) - CATEGORY_PRIORITY.indexOf(b.record.category) ||
      a.record.name.length - b.record.name.length || a.record.name.localeCompare(b.record.name));
  return hits.slice(0, limit);
}
