import { describe, expect, it } from 'vitest';
import { RAD_TO_DEG } from '../../core/orbit/constants';
import { ecefToGeodetic, temePositionToEcef } from '../../core/orbit/coordinate-transformations';
import { sunDirectionTeme } from '../../core/orbit/sun-position';
import { gmstRad } from '../../core/orbit/time-utils';

const declinationDeg = (ms: number) => Math.asin(sunDirectionTeme(ms).z) * RAD_TO_DEG;

/** Longitude where the Sun is overhead: rotate the Sun direction into ECEF. */
function subsolarLongitudeDeg(ms: number): number {
  const s = sunDirectionTeme(ms);
  const e = temePositionToEcef({ x: s.x * 1e5, y: s.y * 1e5, z: s.z * 1e5 }, gmstRad(ms));
  return ecefToGeodetic(e).longitudeDeg;
}

describe('sunDirectionTeme', () => {
  it('returns a unit vector', () => {
    const s = sunDirectionTeme(Date.UTC(2026, 10, 24, 12));
    expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 12);
  });

  // Equinox/solstice instants from the US Naval Observatory.
  it('has ~0 declination at the March 2024 equinox (Mar 20 03:06 UTC)', () => {
    expect(Math.abs(declinationDeg(Date.UTC(2024, 2, 20, 3, 6)))).toBeLessThan(0.02);
  });

  it('has +23.44 deg declination at the June 2024 solstice (Jun 20 20:51 UTC)', () => {
    expect(declinationDeg(Date.UTC(2024, 5, 20, 20, 51))).toBeCloseTo(23.44, 1);
  });

  it('has -23.44 deg declination at the December 2025 solstice (Dec 21 15:03 UTC)', () => {
    expect(declinationDeg(Date.UTC(2025, 11, 21, 15, 3))).toBeCloseTo(-23.44, 1);
  });

  it('puts the subsolar point where the equation of time says', () => {
    // Early November the equation of time is about +16.4 min: the Sun crosses
    // Greenwich about 16.4 min before 12:00 UTC, so at 12:00 UTC it is
    // overhead about 4.1 deg west.
    expect(subsolarLongitudeDeg(Date.UTC(2024, 10, 3, 12))).toBeCloseTo(-4.1, 0);
    // Mid February the equation of time is about -14.2 min: ~3.55 deg east.
    expect(subsolarLongitudeDeg(Date.UTC(2025, 1, 11, 12))).toBeCloseTo(3.55, 0);
  });
});
