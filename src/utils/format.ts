/**
 * Display formatting. Internal values stay UTC ms / km / degrees; these
 * helpers only turn them into strings. Local-time output uses the browser's
 * time zone via Intl.
 */

const pad = (n: number, width = 2) => String(Math.trunc(n)).padStart(width, '0');

/** `2026-11-24 19:05:03Z` */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '----';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

const localFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

/** Local date/time in the browser's time zone, with the zone name. */
export function formatLocal(ms: number): string {
  return localFormatter.format(new Date(ms));
}

/** Compact duration: `45 s`, `12 min`, `3.2 h`, `4.5 d`. Sign is dropped. */
export function formatDuration(ms: number): string {
  const s = Math.abs(ms) / 1000;
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  if (s < 48 * 3600) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} d`;
}

/** Signed latitude/longitude with hemisphere letter, e.g. `51.477° N`. */
export function formatLatitude(deg: number, digits = 3): string {
  return `${Math.abs(deg).toFixed(digits)}° ${deg >= 0 ? 'N' : 'S'}`;
}

export function formatLongitude(deg: number, digits = 3): string {
  return `${Math.abs(deg).toFixed(digits)}° ${deg >= 0 ? 'E' : 'W'}`;
}

export function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Signed clock offset, e.g. `+00:05:00`, `-3d 04:00:00`. Used to show how far
 * simulation time is from real time.
 */
export function formatClockOffset(offsetMs: number): string {
  const totalS = Math.trunc(Math.abs(offsetMs) / 1000);
  const sign = totalS === 0 ? '±' : offsetMs < 0 ? '-' : '+';
  const days = Math.floor(totalS / 86400);
  const hms = `${pad(Math.floor((totalS % 86400) / 3600))}:${pad(Math.floor((totalS % 3600) / 60))}:${pad(totalS % 60)}`;
  return `${sign}${days > 0 ? `${days}d ` : ''}${hms}`;
}
