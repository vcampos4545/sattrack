/**
 * Display formatting for pass times. Values stay UTC ms internally; these
 * render them in the browser's local time zone.
 */
const pad = (n: number) => String(Math.trunc(n)).padStart(2, '0');

const localTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const localDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const zoneName = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' });

/** `19:05:03` in local time. */
export function formatLocalTime(ms: number): string {
  return localTime.format(new Date(ms));
}

/** `Tue, Nov 24` in local time. */
export function formatLocalDay(ms: number): string {
  return localDay.format(new Date(ms));
}

/** Short local time-zone name at `ms`, e.g. `MST` or `GMT+1`. */
export function localZoneName(ms: number): string {
  return zoneName.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? 'local';
}

/** Countdown clock: `04:12`, `1:23:45`, `2d 03:12:44`. Sign dropped. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** Pass length: `9m 41s`, or `3h 05m` for long passes. */
export function formatPassDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

/** Azimuth with three digits, e.g. `047°`. */
export function formatAzimuth(deg: number): string {
  return `${String(Math.round(deg) % 360).padStart(3, '0')}°`;
}
