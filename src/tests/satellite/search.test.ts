import { describe, expect, it } from 'vitest';
import type { SatelliteRecord } from '../../types/satellite';
import { parseNoradQuery, searchSatellites } from '../../utils/satellite-search';

function rec(noradId: number, name: string, intlDesignator = ''): SatelliteRecord {
  return {
    noradId,
    name,
    category: 'other',
    groups: [],
    tle: { intlDesignator } as SatelliteRecord['tle'],
  };
}

const records = [
  rec(25544, 'ISS (ZARYA)', '98067A'),
  rec(33591, 'NOAA 19', '09005A'),
  rec(28654, 'NOAA 18', '05018A'),
  rec(25338, 'NOAA 15', '98030A'),
  rec(48274, 'CSS (TIANHE)', '21035A'),
  rec(2554, 'TEST 2554'),
];

describe('parseNoradQuery', () => {
  it('accepts plain or #-prefixed integers only', () => {
    expect(parseNoradQuery('25544')).toBe(25544);
    expect(parseNoradQuery(' #25544 ')).toBe(25544);
    expect(parseNoradQuery('ISS')).toBeNull();
    expect(parseNoradQuery('0')).toBeNull();
    expect(parseNoradQuery('12.5')).toBeNull();
  });
});

describe('searchSatellites', () => {
  const names = (q: string) => searchSatellites(records, q).map((h) => h.record.name);

  it('returns nothing for an empty query', () => {
    expect(searchSatellites(records, '  ')).toEqual([]);
  });

  it('ranks an exact NORAD id first, then id prefixes', () => {
    expect(names('2554')).toEqual(['TEST 2554', 'ISS (ZARYA)']);
    expect(names('25544')[0]).toBe('ISS (ZARYA)');
  });

  it('matches names case-insensitively by prefix, word prefix and substring', () => {
    expect(names('iss')[0]).toBe('ISS (ZARYA)');
    expect(names('zarya')).toEqual(['ISS (ZARYA)']);
    expect(names('noaa')).toEqual(['NOAA 15', 'NOAA 18', 'NOAA 19']);
    expect(names('ianh')).toEqual(['CSS (TIANHE)']);
  });

  it('ignores spaces and punctuation as a last resort', () => {
    expect(names('noaa19')).toEqual(['NOAA 19']);
  });

  it('matches international designators', () => {
    expect(names('98067')).toContain('ISS (ZARYA)');
    expect(names('21035')).toEqual(['CSS (TIANHE)']);
  });
});
