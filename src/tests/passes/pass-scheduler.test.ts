import { describe, expect, it } from 'vitest';
import type { PassSearchResult } from '../../core/orbit/pass-prediction';
import { matchPass, needsRecompute } from '../../services/pass-scheduler';
import type { Pass } from '../../types/passes';

const H = 3_600_000;

function pass(aosMs: number, losMs: number, maxElevationMs = (aosMs + losMs) / 2): Pass {
  return {
    id: `1-${aosMs}`,
    noradId: 1,
    elevationMaskDeg: 10,
    aosMs,
    aosAzimuthDeg: 0,
    losMs,
    losAzimuthDeg: 180,
    maxElevationMs,
    maxElevationDeg: 45,
    maxElevationAzimuthDeg: 90,
    durationS: (losMs - aosMs) / 1000,
    inProgressAtSearchStart: false,
    track: [],
  };
}

function result(passes: Pass[], searchStartMs = 0, days = 7): PassSearchResult {
  return {
    noradId: 1,
    status: passes.length ? 'ok' : 'never-above-mask',
    passes,
    searchStartMs,
    windowEndMs: searchStartMs + days * 24 * H,
    scannedUntilMs: searchStartMs + days * 24 * H,
    elevationMaskDeg: 10,
    highestSampledElevationDeg: 45,
    evaluations: 0,
    propagationFailures: 0,
    error: null,
  };
}

describe('needsRecompute', () => {
  const full = result([pass(1 * H, 1.2 * H), pass(3 * H, 3.2 * H)]);

  it('keeps a result while its passes are still ahead or in progress', () => {
    expect(needsRecompute(full, 0, 2)).toBe(false);
    expect(needsRecompute(full, 1.1 * H, 2)).toBe(false); // first pass in progress
  });

  it('recomputes once a pass has ended', () => {
    expect(needsRecompute(full, 1.2 * H, 2)).toBe(true);
  });

  it('recomputes when the clock moves before the search start', () => {
    expect(needsRecompute(result([pass(1 * H, 1.2 * H)], 10 * H), 9 * H, 1)).toBe(true);
    expect(needsRecompute(result([pass(11 * H, 11.2 * H)], 10 * H), 10 * H - 500, 1)).toBe(false);
  });

  it('slides a window that returned fewer passes than requested', () => {
    const sparse = result([], 0, 8); // 8 days: recompute after 1 day of drift
    expect(needsRecompute(sparse, 23 * H, 10)).toBe(false);
    expect(needsRecompute(sparse, 25 * H, 10)).toBe(true);
  });
});

describe('matchPass', () => {
  it('follows a pass whose AOS shifted (e.g. mask changed)', () => {
    const old = pass(1000, 9000, 5000);
    const next = [pass(20_000, 30_000), pass(2500, 7500, 5010)];
    expect(matchPass(old, next)).toBe(next[1]);
  });

  it('returns null when the pass is gone', () => {
    expect(matchPass(pass(1000, 9000, 5000), [pass(20_000, 30_000)])).toBeNull();
  });
});
