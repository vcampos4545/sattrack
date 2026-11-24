import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTimeInput, parseDateTimeInput } from '../../core/orbit/time-utils';
import { getWallClockMs, setWallClock, useTimeStore } from '../../stores/time-store';
import { formatClockOffset } from '../../utils/format';

describe('datetime-local conversions', () => {
  it('reads UTC fields as UTC', () => {
    expect(parseDateTimeInput('2026-11-24T19:05:03', 'utc')).toBe(Date.UTC(2026, 10, 24, 19, 5, 3));
    expect(parseDateTimeInput('2026-11-24T19:05', 'utc')).toBe(Date.UTC(2026, 10, 24, 19, 5, 0));
    expect(parseDateTimeInput('2026-11-24 19:05:03.25', 'utc')).toBe(Date.UTC(2026, 10, 24, 19, 5, 3, 250));
  });

  it('reads local fields using the runtime zone offset at that instant', () => {
    for (const text of ['2026-01-15T03:30:00', '2026-07-15T03:30:00', '2024-02-29T23:59:59']) {
      const ms = parseDateTimeInput(text, 'local');
      expect(ms).not.toBeNull();
      // Independent check: local wall time = UTC instant minus getTimezoneOffset.
      const [y, mo, day, h, mi, s] = text.split(/[-T:]/).map(Number) as [number, number, number, number, number, number];
      const offsetMin = new Date(ms!).getTimezoneOffset();
      expect(ms! - offsetMin * 60_000).toBe(Date.UTC(y, mo - 1, day, h, mi, s));
    }
  });

  it('round-trips in both zones', () => {
    const ms = Date.UTC(2031, 5, 30, 23, 59, 58);
    for (const zone of ['utc', 'local'] as const) {
      expect(parseDateTimeInput(formatDateTimeInput(ms, zone), zone)).toBe(ms);
    }
    expect(formatDateTimeInput(ms, 'utc')).toBe('2031-06-30T23:59:58');
  });

  it('crosses the UTC date line in either direction', () => {
    // 23:30 UTC on Dec 31 is a different calendar day for any zone east of UTC+0:30.
    const ms = Date.UTC(2026, 11, 31, 23, 30, 0);
    expect(formatDateTimeInput(ms, 'utc')).toBe('2026-12-31T23:30:00');
    expect(parseDateTimeInput(formatDateTimeInput(ms, 'local'), 'local')).toBe(ms);
  });

  it('keeps years below 100 instead of mapping them to the 1900s', () => {
    expect(new Date(parseDateTimeInput('0050-03-01T00:00:00', 'utc')!).getUTCFullYear()).toBe(50);
    expect(formatDateTimeInput(Date.UTC(1957, 9, 4, 19, 28, 34), 'utc')).toBe('1957-10-04T19:28:34');
  });

  it('rejects malformed and impossible values instead of rolling over', () => {
    for (const bad of ['', 'now', '2026-11-24', '2026-02-30T00:00', '2025-02-29T00:00', '2026-13-01T00:00', '2026-11-24T24:00', '2026-11-24T12:60', '2026-11-24T12:00:60']) {
      expect(parseDateTimeInput(bad, 'utc')).toBeNull();
      expect(parseDateTimeInput(bad, 'local')).toBeNull();
    }
    expect(formatDateTimeInput(Number.NaN, 'utc')).toBe('');
  });
});

describe('clock offset formatting', () => {
  it('signs and splits offsets', () => {
    expect(formatClockOffset(0)).toBe('±00:00:00');
    expect(formatClockOffset(999)).toBe('±00:00:00');
    expect(formatClockOffset(5 * 60_000)).toBe('+00:05:00');
    expect(formatClockOffset(-(3 * 86_400_000 + 4 * 3_600_000 + 5_000))).toBe('-3d 04:00:05');
  });
});

describe('time store wall clock', () => {
  afterEach(() => setWallClock(() => Date.now()));

  it('exposes the injected wall clock, independent of sim time', () => {
    let real = 2_000_000;
    setWallClock(() => real);
    const t = useTimeStore.getState();
    t.resetToLive();
    t.setRate(-60);
    real += 1000;
    expect(getWallClockMs()).toBe(2_001_000);
    expect(useTimeStore.getState().now()).toBe(2_000_000 - 60_000);
    expect(useTimeStore.getState().now() - getWallClockMs()).toBe(-61_000);
  });

  it('jumping to a parsed instant keeps the paused state', () => {
    setWallClock(() => 0);
    const t = useTimeStore.getState();
    t.resetToLive();
    t.pause();
    const target = parseDateTimeInput('2027-03-14T15:09:26', 'utc')!;
    t.jumpTo(target);
    expect(useTimeStore.getState().paused).toBe(true);
    expect(useTimeStore.getState().now()).toBe(target);
  });
});
