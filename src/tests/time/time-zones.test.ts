/**
 * Local-time display across time zones. Internal values are UTC ms; only the
 * formatters in utils/format.ts and components/passes/pass-format.ts apply the
 * browser zone. Each case sets TZ and re-imports those modules, because
 * Intl.DateTimeFormat captures the default zone when it is constructed.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

afterAll(() => {
  vi.unstubAllEnvs();
});

async function formattersIn(tz: string) {
  // Assigning process.env.TZ makes Node reset its default zone.
  vi.stubEnv('TZ', tz);
  vi.resetModules();
  const passFormat = await import('../../components/passes/pass-format');
  const format = await import('../../utils/format');
  return { ...passFormat, ...format };
}

const at = (iso: string) => Date.parse(iso);

describe('pass times in local time', () => {
  it('shows the same UTC instant correctly in several zones (including half-hour and 45-minute offsets)', async () => {
    const t = at('2026-11-24T23:30:15Z');
    const cases: Array<[string, string, string]> = [
      ['UTC', '23:30:15', 'Nov 24'],
      ['America/Denver', '16:30:15', 'Nov 24'], // MST, UTC-7
      ['Asia/Kolkata', '05:00:15', 'Nov 25'], // UTC+5:30, next day
      ['Pacific/Chatham', '13:15:15', 'Nov 25'], // UTC+13:45 in southern summer
      ['Pacific/Honolulu', '13:30:15', 'Nov 24'], // UTC-10
    ];
    for (const [tz, time, day] of cases) {
      const f = await formattersIn(tz);
      expect(f.formatLocalTime(t), tz).toBe(time);
      expect(f.formatLocalDay(t), tz).toContain(day);
      // UTC rendering never depends on the zone.
      expect(f.formatUtc(t), tz).toBe('2026-11-24 23:30:15Z');
    }
  });

  it('follows daylight saving changes within one pass list', async () => {
    const f = await formattersIn('America/New_York');
    // US DST starts 2026-03-08 at 07:00Z (02:00 EST -> 03:00 EDT).
    expect(f.formatLocalTime(at('2026-03-08T06:59:59Z'))).toBe('01:59:59');
    expect(f.formatLocalTime(at('2026-03-08T07:00:00Z'))).toBe('03:00:00');
    expect(f.localZoneName(at('2026-03-08T06:00:00Z'))).toBe('EST');
    expect(f.localZoneName(at('2026-03-08T08:00:00Z'))).toBe('EDT');
  });

  it('keeps durations and countdowns zone-independent', async () => {
    const a = await formattersIn('Asia/Tokyo');
    const b = await formattersIn('America/Los_Angeles');
    expect(a.formatPassDuration(581)).toBe(b.formatPassDuration(581));
    expect(a.formatCountdown(3_723_000)).toBe('1:02:03');
    expect(b.formatCountdown(3_723_000)).toBe('1:02:03');
  });
});
