/**
 * Parses user-typed coordinates for the manual location form.
 *
 * Accepted forms (all return signed decimal degrees, north/east positive):
 *   `40.7128`, `-74.006`            signed decimal
 *   `40.7128 N`, `74.006W`          decimal with hemisphere letter
 *   `40°42'46"N`, `40 42 46.1 N`    degrees, minutes, seconds
 *   `74° 0.36' W`                   degrees, decimal minutes
 *
 * Returns NaN for anything else (including empty input, a letter from the
 * wrong axis such as `E` on latitude, or minutes/seconds >= 60), so range
 * checks in `validateObserverLocation` report it as invalid.
 */
export function parseCoordinate(input: string, axis: 'lat' | 'lon'): number {
  let s = input.trim().toUpperCase().replace(/,/g, '.');
  if (!s) return NaN;

  let sign = 1;
  let letter: string | null = null;
  const lead = s.match(/^([NSEW])\s*(.+)$/);
  const trail = s.match(/^(.+?)\s*([NSEW])$/);
  if (lead) {
    letter = lead[1] ?? null;
    s = lead[2] ?? '';
  } else if (trail) {
    s = trail[1] ?? '';
    letter = trail[2] ?? null;
  }
  if (letter) {
    s = s.trim();
    const allowed = axis === 'lat' ? 'NS' : 'EW';
    if (!allowed.includes(letter)) return NaN;
    if (letter === 'S' || letter === 'W') sign = -1;
    if (s.startsWith('-') || s.startsWith('+')) return NaN; // "-40 N" is ambiguous
  }

  // Split on degree/minute/second marks or whitespace.
  const parts = s
    .replace(/[°º˚]/g, ' ')
    .replace(/['′’]/g, ' ')
    .replace(/["″”]/g, ' ')
    .trim()
    .split(/\s+/);
  if (parts.length === 0 || parts.length > 3) return NaN;
  if (!parts.every((p, i) => (i === 0 ? /^[+-]?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(p))) return NaN;
  // Only the last component may carry a fraction.
  if (parts.slice(0, -1).some((p) => p.includes('.'))) return NaN;

  const [d = NaN, m = 0, sec = 0] = parts.map(Number);
  if (m >= 60 || sec >= 60) return NaN;
  const negative = parts[0]?.startsWith('-') ?? false;
  const magnitude = Math.abs(d) + m / 60 + sec / 3600;
  return sign * (negative ? -magnitude : magnitude);
}

/** Parses an altitude field in meters. Empty input is NaN. */
export function parseAltitude(input: string): number {
  const s = input.trim().replace(/\s*m$/i, '');
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}
