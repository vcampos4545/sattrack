/**
 * Two-line element set parser and validator.
 *
 * Accepts CelesTrak `FORMAT=tle` output (three-line: title, line 1, line 2)
 * and bare two-line sets. Each record is validated before it can reach SGP4:
 * line numbers, line length, modulo-10 checksums, matching catalog numbers on
 * both lines, eccentricity in [0, 1) and positive mean motion. Malformed
 * records are reported in `errors` and skipped, never silently "fixed".
 *
 * Column positions follow the NORAD TLE format (1-based columns in comments,
 * 0-based slices in code).
 */
import { alpha5ToNumber } from 'satellite.js';
import type { TleRecord } from '../../types/satellite';
import { tleEpochToMs } from './time-utils';

export interface TleParseError {
  /** 1-based line number in the input text where the record starts. */
  line: number;
  message: string;
}

export interface TleParseResult {
  records: TleRecord[];
  errors: TleParseError[];
}

const TLE_LINE_LENGTH = 69;

/** TLE checksum: sum of digits, minus signs count as 1, everything else 0; mod 10. */
export function tleChecksum(line: string): number {
  let sum = 0;
  for (let i = 0; i < 68 && i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c >= 48 && c <= 57) sum += c - 48;
    else if (c === 45) sum += 1; // '-'
  }
  return sum % 10;
}

/**
 * Parses a TLE "assumed decimal point" exponent field such as ` 12345-3`
 * (meaning 0.12345e-3), used by the second derivative of mean motion and B*.
 */
export function parseExponentField(field: string): number {
  const s = field.trim();
  if (s === '') return 0;
  const m = /^([+-]?)(\d+)([+-]\d)$/.exec(s);
  if (!m) return Number.NaN;
  const [, sign, mantissa, exponent] = m;
  const value = Number(`0.${mantissa}`) * 10 ** Number(exponent);
  return sign === '-' ? -value : value;
}

/** Validates and parses one line pair. Throws an Error with a reason on invalid input. */
export function parseTlePair(nameLine: string | null, line1: string, line2: string): TleRecord {
  const l1 = line1.trimEnd();
  const l2 = line2.trimEnd();
  if (l1.length !== TLE_LINE_LENGTH || l2.length !== TLE_LINE_LENGTH) {
    throw new Error(`TLE lines must be ${TLE_LINE_LENGTH} characters (got ${l1.length} and ${l2.length})`);
  }
  if (l1[0] !== '1' || l2[0] !== '2') throw new Error('Line numbers must be 1 and 2');
  if (!/\d/.test(l1[68] ?? '') || !/\d/.test(l2[68] ?? '')) throw new Error('Checksum column must be a digit');
  const check1 = Number(l1[68]);
  const check2 = Number(l2[68]);
  if (tleChecksum(l1) !== check1) throw new Error(`Line 1 checksum mismatch (expected ${tleChecksum(l1)}, found ${l1[68]})`);
  if (tleChecksum(l2) !== check2) throw new Error(`Line 2 checksum mismatch (expected ${tleChecksum(l2)}, found ${l2[68]})`);

  // Columns 3-7: catalog number, possibly Alpha-5 encoded (e.g. A0001 = 100001).
  const satnum1 = l1.slice(2, 7);
  const satnum2 = l2.slice(2, 7);
  if (satnum1 !== satnum2) throw new Error(`Catalog numbers differ between lines (${satnum1} vs ${satnum2})`);
  const noradId = alpha5ToNumber(satnum1);
  if (!Number.isInteger(noradId) || noradId <= 0) throw new Error(`Invalid catalog number "${satnum1}"`);

  const intlDesignator = l1.slice(9, 17).trim(); // cols 10-17
  const epochYear = Number(l1.slice(18, 20)); // cols 19-20
  const epochDay = Number(l1.slice(20, 32)); // cols 21-32
  if (!Number.isFinite(epochYear) || !Number.isFinite(epochDay) || epochDay < 1 || epochDay >= 367) {
    throw new Error('Invalid epoch');
  }
  const bstar = parseExponentField(l1.slice(53, 61)); // cols 54-61

  const inclinationDeg = Number(l2.slice(8, 16)); // cols 9-16
  const raanDeg = Number(l2.slice(17, 25)); // cols 18-25
  const eccentricity = Number(`0.${l2.slice(26, 33).trim()}`); // cols 27-33, implied leading decimal
  const argPerigeeDeg = Number(l2.slice(34, 42)); // cols 35-42
  const meanAnomalyDeg = Number(l2.slice(43, 51)); // cols 44-51
  const meanMotionRevPerDay = Number(l2.slice(52, 63)); // cols 53-63

  const numeric = { inclinationDeg, raanDeg, eccentricity, argPerigeeDeg, meanAnomalyDeg, meanMotionRevPerDay, bstar };
  for (const [key, value] of Object.entries(numeric)) {
    if (!Number.isFinite(value)) throw new Error(`Field ${key} is not a number`);
  }
  if (inclinationDeg < 0 || inclinationDeg > 180) throw new Error(`Inclination out of range: ${inclinationDeg}`);
  if (eccentricity < 0 || eccentricity >= 1) throw new Error(`Eccentricity out of range: ${eccentricity}`);
  if (meanMotionRevPerDay <= 0) throw new Error(`Mean motion must be positive: ${meanMotionRevPerDay}`);

  // CelesTrak 3LE title lines may be prefixed with "0 ".
  const rawName = nameLine?.replace(/^0 /, '').trim() ?? '';

  return {
    name: rawName || `NORAD ${noradId}`,
    line1: l1,
    line2: l2,
    noradId,
    intlDesignator,
    epochMs: tleEpochToMs(epochYear, epochDay),
    inclinationDeg,
    raanDeg,
    eccentricity,
    argPerigeeDeg,
    meanAnomalyDeg,
    meanMotionRevPerDay,
    periodMin: 1440 / meanMotionRevPerDay,
    bstar,
  };
}

/**
 * Parses a block of TLE text. Blank lines are ignored. A line that is neither
 * line 1 nor line 2 is treated as the title for the pair that follows it.
 */
export function parseTleText(text: string): TleParseResult {
  const lines = text.split(/\r?\n/);
  const records: TleRecord[] = [];
  const errors: TleParseError[] = [];
  let pendingName: { text: string; line: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    if (line.startsWith('1 ')) {
      const next = lines[i + 1] ?? '';
      const startLine = pendingName?.line ?? i + 1;
      if (!next.startsWith('2 ')) {
        errors.push({ line: i + 1, message: 'Line 1 is not followed by a line 2' });
        pendingName = null;
        continue;
      }
      try {
        records.push(parseTlePair(pendingName?.text ?? null, line, next));
      } catch (err) {
        const name = pendingName?.text.trim();
        errors.push({ line: startLine, message: `${name ? `${name}: ` : ''}${(err as Error).message}` });
      }
      pendingName = null;
      i++; // consumed line 2
    } else if (line.startsWith('2 ')) {
      errors.push({ line: i + 1, message: 'Line 2 without a preceding line 1' });
      pendingName = null;
    } else {
      if (pendingName) errors.push({ line: pendingName.line, message: `Title "${pendingName.text.trim()}" has no element lines` });
      pendingName = { text: line, line: i + 1 };
    }
  }
  if (pendingName) errors.push({ line: pendingName.line, message: `Title "${pendingName.text.trim()}" has no element lines` });
  return { records, errors };
}
