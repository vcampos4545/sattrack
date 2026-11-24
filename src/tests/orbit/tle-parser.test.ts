import { describe, expect, it } from 'vitest';
import { parseExponentField, parseTlePair, parseTleText, tleChecksum } from '../../core/orbit/tle-parser';

// ISS element set from the satellite.js README / CelesTrak, 2019-06-05.
const ISS_L1 = '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992';
const ISS_L2 = '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442';

describe('tleChecksum', () => {
  it('matches the checksum digit of real element lines', () => {
    expect(tleChecksum(ISS_L1)).toBe(2);
    expect(tleChecksum(ISS_L2)).toBe(2);
  });
});

describe('parseExponentField', () => {
  it('decodes assumed-decimal exponent notation', () => {
    expect(parseExponentField(' 59442-4')).toBeCloseTo(0.59442e-4, 12);
    expect(parseExponentField('-11606-4')).toBeCloseTo(-0.11606e-4, 12);
    expect(parseExponentField(' 00000-0')).toBe(0);
    expect(parseExponentField('        ')).toBe(0);
    expect(parseExponentField('garbage!')).toBeNaN();
  });
});

describe('parseTlePair', () => {
  it('extracts all orbital elements with units', () => {
    const r = parseTlePair('ISS (ZARYA)', ISS_L1, ISS_L2);
    expect(r.name).toBe('ISS (ZARYA)');
    expect(r.noradId).toBe(25544);
    expect(r.intlDesignator).toBe('98067A');
    expect(r.inclinationDeg).toBe(51.6433);
    expect(r.raanDeg).toBe(59.2583);
    expect(r.eccentricity).toBeCloseTo(0.0008217, 10);
    expect(r.argPerigeeDeg).toBe(16.4489);
    expect(r.meanAnomalyDeg).toBe(347.6017);
    expect(r.meanMotionRevPerDay).toBe(15.51174618);
    expect(r.periodMin).toBeCloseTo(92.83, 2);
    expect(r.bstar).toBeCloseTo(0.59442e-4, 12);
    // Day 156.50900463 of 2019 = June 5 (day 156), 0.50900463 d = 12:12:58.0 UTC
    expect(new Date(r.epochMs).toISOString().slice(0, 19)).toBe('2019-06-05T12:12:58');
    expect(r.epochMs).toBeCloseTo(Date.UTC(2019, 5, 5) + 0.50900463 * 86_400_000, 0);
  });

  it('strips the "0 " prefix CelesTrak uses on 3LE title lines', () => {
    expect(parseTlePair('0 ISS (ZARYA)', ISS_L1, ISS_L2).name).toBe('ISS (ZARYA)');
  });

  it('uses the NORAD id as the name when there is no title line', () => {
    expect(parseTlePair(null, ISS_L1, ISS_L2).name).toBe('NORAD 25544');
  });

  it('decodes Alpha-5 catalog numbers', () => {
    // Rewrite the catalog field to A0001 (=100001) and fix the checksums.
    const fix = (line: string) => {
      const body = line.slice(0, 68);
      return body + String(tleChecksum(body));
    };
    const l1 = fix(ISS_L1.replace('25544U', 'A0001U'));
    const l2 = fix(ISS_L2.replace('2 25544', '2 A0001'));
    expect(parseTlePair('X', l1, l2).noradId).toBe(100001);
  });

  it('maps two-digit epoch years across the 1957/2056 pivot', () => {
    const fix = (line: string) => line.slice(0, 68) + String(tleChecksum(line.slice(0, 68)));
    const l1 = fix(ISS_L1.replace('19156.50900463', '98001.00000000'));
    expect(new Date(parseTlePair('X', l1, ISS_L2).epochMs).toISOString()).toBe('1998-01-01T00:00:00.000Z');
  });

  it('rejects bad checksums', () => {
    const bad = ISS_L1.slice(0, 68) + '3';
    expect(() => parseTlePair('X', bad, ISS_L2)).toThrow(/checksum/);
  });

  it('rejects mismatched catalog numbers', () => {
    const fix = (line: string) => line.slice(0, 68) + String(tleChecksum(line.slice(0, 68)));
    const l2 = fix(ISS_L2.replace('2 25544', '2 25545'));
    expect(() => parseTlePair('X', ISS_L1, l2)).toThrow(/Catalog numbers differ/);
  });

  it('rejects truncated lines', () => {
    expect(() => parseTlePair('X', ISS_L1.slice(0, 60), ISS_L2)).toThrow(/69 characters/);
  });
});

describe('parseTleText', () => {
  it('parses 3LE and 2LE records and reports malformed ones without dropping good ones', () => {
    const text = [
      'ISS (ZARYA)',
      ISS_L1,
      ISS_L2,
      '',
      'BROKEN SAT',
      ISS_L1.slice(0, 68) + '0',
      ISS_L2,
      ISS_L1,
      ISS_L2,
      'ORPHAN TITLE',
    ].join('\r\n');
    const { records, errors } = parseTleText(text);
    expect(records.map((r) => r.name)).toEqual(['ISS (ZARYA)', 'NORAD 25544']);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.message).toMatch(/BROKEN SAT: Line 1 checksum/);
    expect(errors[0]?.line).toBe(5);
    expect(errors[1]?.message).toMatch(/ORPHAN TITLE/);
  });

  it('flags a line 1 without its line 2', () => {
    const { records, errors } = parseTleText(`X\n${ISS_L1}\n`);
    expect(records).toHaveLength(0);
    expect(errors[0]?.message).toMatch(/not followed by a line 2/);
  });
});
