import { describe, expect, it } from 'vitest';
import { degreesToRadians, ecfToLookAngles, eciToEcf, gstime, propagate, type SatRec } from 'satellite.js';
import {
  compassPoint,
  currentOrNextPass,
  isPassInProgress,
  passDirection,
  predictPasses,
  type PassSearchOptions,
} from '../../core/orbit/pass-prediction';
import { computeSatelliteState, lookAnglesAt } from '../../core/orbit/satellite-propagator';
import { createSatrec, satrecFor } from '../../core/orbit/sgp4';
import { parseTlePair } from '../../core/orbit/tle-parser';
import type { ObserverLocation } from '../../types/observer';
import type { Pass } from '../../types/passes';

const ISS = parseTlePair(
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
);
const GEO = parseTlePair(
  'TEST GEO',
  '1 41866U 16071A   26320.50000000 -.00000088  00000-0  00000-0 0  9995',
  '2 41866   0.0500  95.0000 0001000 270.0000  90.0000  1.00271000 30009',
);

/** Appends the modulo-10 TLE checksum to a 68-character line. */
function withChecksum(line68: string): string {
  let sum = 0;
  for (const ch of line68) {
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return line68 + (sum % 10);
}

/** Synthetic sun-synchronous polar orbit (98.7 deg, ~850 km, NOAA-like), valid checksums. */
const POLAR = parseTlePair(
  'TEST POLAR',
  withChecksum('1 99001U 26001A   26320.50000000  .00000050  00000-0  45000-4 0  999'),
  withChecksum('2 99001  98.7000 120.0000 0013000  90.0000 270.0000 14.1250000000001'),
);

const boulder: ObserverLocation = { latitudeDeg: 40.015, longitudeDeg: -105.27, altitudeM: 1655, source: 'manual' };
const issSat = satrecFor(ISS);

const opts = (patch: Partial<PassSearchOptions> = {}): PassSearchOptions => ({
  startMs: ISS.epochMs,
  elevationMaskDeg: 10,
  maxPasses: 10,
  searchDays: 2,
  scanStepS: 30,
  ...patch,
});

/**
 * Independent reference: elevation from satellite.js's own frame rotation
 * (`gstime`, `eciToEcf`) and look-angle routine (`ecfToLookAngles`), which share
 * no code with core/orbit beyond SGP4 itself.
 */
function referenceElevationDeg(satrec: SatRec, obs: ObserverLocation, timeMs: number): number {
  const date = new Date(timeMs);
  const pv = propagate(satrec, date);
  if (!pv) throw new Error('propagation failed');
  const ecf = eciToEcf(pv.position, gstime(date));
  const look = ecfToLookAngles(
    {
      latitude: degreesToRadians(obs.latitudeDeg),
      longitude: degreesToRadians(obs.longitudeDeg),
      height: obs.altitudeM / 1000,
    },
    ecf,
  );
  return (look.elevation * 180) / Math.PI;
}

/** Brute-force 1 s scan with the reference elevation: rise/set times and peak. */
function referencePasses(satrec: SatRec, obs: ObserverLocation, startMs: number, endMs: number, mask: number) {
  const out: Array<{ aosMs: number; losMs: number; maxDeg: number }> = [];
  let open: { aosMs: number; maxDeg: number } | null = null;
  for (let t = startMs; t <= endMs; t += 1000) {
    const el = referenceElevationDeg(satrec, obs, t);
    if (el >= mask) {
      if (!open) open = { aosMs: t, maxDeg: el };
      else open.maxDeg = Math.max(open.maxDeg, el);
    } else if (open) {
      out.push({ ...open, losMs: t });
      open = null;
    }
  }
  return out;
}

function expectWellFormed(pass: Pass, mask: number) {
  expect(pass.losMs).toBeGreaterThan(pass.aosMs);
  expect(pass.durationS).toBeCloseTo((pass.losMs - pass.aosMs) / 1000, 9);
  expect(pass.maxElevationMs).toBeGreaterThanOrEqual(pass.aosMs);
  expect(pass.maxElevationMs).toBeLessThanOrEqual(pass.losMs);
  expect(pass.maxElevationDeg).toBeGreaterThanOrEqual(mask);
  expect(pass.id).toBe(`${pass.noradId}-${pass.aosMs}`);
  expect(pass.track.length).toBeGreaterThan(10);
  expect(pass.track[0]!.timeMs).toBe(pass.aosMs);
  expect(pass.track[pass.track.length - 1]!.timeMs).toBe(pass.losMs);
  for (let i = 1; i < pass.track.length; i++) expect(pass.track[i]!.timeMs).toBeGreaterThan(pass.track[i - 1]!.timeMs);
  for (const s of pass.track) {
    expect(s.elevationDeg).toBeGreaterThan(mask - 0.01);
    expect(s.elevationDeg).toBeLessThanOrEqual(pass.maxElevationDeg + 1e-6);
    expect(s.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(s.azimuthDeg).toBeLessThan(360);
  }
}

describe('predictPasses: ISS over Boulder', () => {
  const result = predictPasses(issSat, boulder, opts(), ISS.noradId);

  it('finds well-formed passes in time order', () => {
    expect(result.status).toBe('ok');
    expect(result.passes.length).toBeGreaterThanOrEqual(4);
    for (const p of result.passes) {
      expectWellFormed(p, 10);
      expect(p.noradId).toBe(25544);
      expect(p.durationS).toBeLessThan(12 * 60); // LEO pass above 10 deg
      expect(p.inProgressAtSearchStart).toBe(false);
    }
    for (let i = 1; i < result.passes.length; i++) {
      expect(result.passes[i]!.aosMs).toBeGreaterThan(result.passes[i - 1]!.losMs);
    }
  });

  it('refines AOS and LOS to the mask crossing', () => {
    for (const p of result.passes) {
      const at = (t: number) => lookAnglesAt(issSat, boulder, t)!.elevationDeg;
      expect(at(p.aosMs)).toBeGreaterThanOrEqual(10);
      expect(at(p.aosMs)).toBeLessThan(10.01);
      expect(at(p.aosMs - 20)).toBeLessThan(10);
      expect(at(p.losMs)).toBeGreaterThanOrEqual(10);
      expect(at(p.losMs + 20)).toBeLessThan(10);
    }
  });

  it('refines the maximum elevation to a true local maximum', () => {
    for (const p of result.passes) {
      const at = (t: number) => lookAnglesAt(issSat, boulder, t)!.elevationDeg;
      expect(p.maxElevationDeg).toBeCloseTo(at(p.maxElevationMs), 9);
      expect(at(p.maxElevationMs - 1000)).toBeLessThanOrEqual(p.maxElevationDeg + 1e-9);
      expect(at(p.maxElevationMs + 1000)).toBeLessThanOrEqual(p.maxElevationDeg + 1e-9);
    }
  });

  it('matches an independent 1 s brute-force reference', () => {
    const ref = referencePasses(issSat, boulder, result.searchStartMs, result.scannedUntilMs + 60_000, 10);
    expect(result.passes.length).toBe(ref.length);
    result.passes.forEach((p, i) => {
      // Reference times are on a 1 s grid; transforms differ only in WGS84 vs
      // satellite.js ellipsoid details, so agree within ~2 s and 0.05 deg.
      expect(Math.abs(p.aosMs - ref[i]!.aosMs)).toBeLessThan(2000);
      expect(Math.abs(p.losMs - ref[i]!.losMs)).toBeLessThan(2000);
      expect(Math.abs(p.maxElevationDeg - ref[i]!.maxDeg)).toBeLessThan(0.05);
    });
  });

  it('stops at maxPasses and reports where it stopped', () => {
    const three = predictPasses(issSat, boulder, opts({ maxPasses: 3 }), ISS.noradId);
    expect(three.passes).toHaveLength(3);
    expect(three.passes.map((p) => p.id)).toEqual(result.passes.slice(0, 3).map((p) => p.id));
    expect(three.scannedUntilMs).toBe(three.passes[2]!.losMs);
    expect(three.evaluations).toBeLessThan(result.evaluations);
  });

  it('respects the elevation mask', () => {
    const high = predictPasses(issSat, boulder, opts({ elevationMaskDeg: 40 }), ISS.noradId);
    expect(high.passes.length).toBeLessThan(result.passes.length);
    const low = predictPasses(issSat, boulder, opts({ elevationMaskDeg: 0 }), ISS.noradId);
    for (const p of high.passes) {
      expectWellFormed(p, 40);
      // Every 40 deg pass sits inside a 0 deg pass and has the same peak.
      const outer = low.passes.find((q) => q.aosMs < p.aosMs && q.losMs > p.losMs);
      expect(outer).toBeDefined();
      expect(Math.abs(outer!.maxElevationMs - p.maxElevationMs)).toBeLessThan(1000);
    }
  });

  it('gives the same passes from a coarse 300 s scan (grazing passes are refined)', () => {
    const fine = predictPasses(issSat, boulder, opts({ scanStepS: 5, maxPasses: 50 }), ISS.noradId);
    const coarse = predictPasses(issSat, boulder, opts({ scanStepS: 300, maxPasses: 50 }), ISS.noradId);
    // Include passes that barely clear the mask.
    expect(fine.passes.some((p) => p.maxElevationDeg < 20)).toBe(true);
    expect(coarse.passes.length).toBe(fine.passes.length);
    coarse.passes.forEach((p, i) => {
      expect(Math.abs(p.aosMs - fine.passes[i]!.aosMs)).toBeLessThan(50);
      expect(Math.abs(p.losMs - fine.passes[i]!.losMs)).toBeLessThan(50);
      expect(p.maxElevationDeg).toBeCloseTo(fine.passes[i]!.maxElevationDeg, 3);
    });
  });

  it('finds the true AOS of a pass already in progress at the start', () => {
    const target = result.passes[1]!;
    const mid = predictPasses(issSat, boulder, opts({ startMs: target.maxElevationMs + 30_000 }), ISS.noradId);
    const first = mid.passes[0]!;
    expect(first.inProgressAtSearchStart).toBe(false);
    expect(Math.abs(first.aosMs - target.aosMs)).toBeLessThan(50);
    expect(Math.abs(first.losMs - target.losMs)).toBeLessThan(50);
    expect(isPassInProgress(first, mid.searchStartMs)).toBe(true);
    expect(currentOrNextPass(mid.passes, mid.searchStartMs)).toBe(first);
  });

  it('accounts for observer altitude', () => {
    const sea = predictPasses(issSat, { ...boulder, altitudeM: 0 }, opts({ maxPasses: 2 }), ISS.noradId);
    const peak = predictPasses(issSat, { ...boulder, altitudeM: 4000 }, opts({ maxPasses: 2 }), ISS.noradId);
    expect(peak.passes[0]!.aosMs).not.toBe(sea.passes[0]!.aosMs);
    // Same pass, slightly different geometry.
    expect(Math.abs(peak.passes[0]!.aosMs - sea.passes[0]!.aosMs)).toBeLessThan(10_000);
  });
});

describe('predictPasses: edge cases', () => {
  it('finds a near-zenith pass for an observer under the ground track', () => {
    const t = ISS.epochMs + 3 * 3_600_000;
    const sub = computeSatelliteState(issSat, t)!.geodetic;
    const under: ObserverLocation = { latitudeDeg: sub.latitudeDeg, longitudeDeg: sub.longitudeDeg, altitudeM: 0, source: 'manual' };
    const r = predictPasses(issSat, under, opts({ startMs: t - 15 * 60_000, maxPasses: 1 }), ISS.noradId);
    const p = r.passes[0]!;
    expectWellFormed(p, 10);
    expect(p.maxElevationDeg).toBeGreaterThan(88);
    expect(Math.abs(p.maxElevationMs - t)).toBeLessThan(5000);
    // Overhead passes flip azimuth by ~180 deg between rise and set.
    const dAz = Math.abs(p.aosAzimuthDeg - p.losAzimuthDeg);
    expect(Math.min(dAz, 360 - dAz)).toBeGreaterThan(170);
  });

  it('reports never-above-mask for a satellite that cannot rise', () => {
    // ISS (51.6 deg inclination) is below the horizon from near the South Pole.
    const pole: ObserverLocation = { latitudeDeg: -89.5, longitudeDeg: 0, altitudeM: 2800, source: 'manual' };
    const r = predictPasses(issSat, pole, opts({ searchDays: 1 }), ISS.noradId);
    expect(r.status).toBe('never-above-mask');
    expect(r.passes).toHaveLength(0);
    expect(r.highestSampledElevationDeg).toBeLessThan(0);
    expect(r.scannedUntilMs).toBeGreaterThanOrEqual(r.windowEndMs - 30_000);
  });

  it('finds frequent passes of a polar orbiter from a polar observer', () => {
    const sat = satrecFor(POLAR);
    const arctic: ObserverLocation = { latitudeDeg: 89, longitudeDeg: 45, altitudeM: 0, source: 'manual' };
    const r = predictPasses(sat, arctic, opts({ startMs: POLAR.epochMs, searchDays: 1, maxPasses: 50 }), POLAR.noradId);
    expect(r.status).toBe('ok');
    // Visible on most of its ~14 daily revolutions.
    expect(r.passes.length).toBeGreaterThanOrEqual(10);
    for (const p of r.passes) expectWellFormed(p, 10);
  });

  it('treats longitude +180 and -180 as the same observer (date line)', () => {
    const east: ObserverLocation = { latitudeDeg: 30, longitudeDeg: 180, altitudeM: 0, source: 'manual' };
    const west: ObserverLocation = { ...east, longitudeDeg: -180 };
    const a = predictPasses(issSat, east, opts({ maxPasses: 3 }), ISS.noradId);
    const b = predictPasses(issSat, west, opts({ maxPasses: 3 }), ISS.noradId);
    expect(a.passes.length).toBe(3);
    a.passes.forEach((p, i) => {
      expect(Math.abs(p.aosMs - b.passes[i]!.aosMs)).toBeLessThan(20);
      expect(p.maxElevationDeg).toBeCloseTo(b.passes[i]!.maxElevationDeg, 6);
    });
  });

  describe('geostationary', () => {
    const geo = satrecFor(GEO);
    const sub = computeSatelliteState(geo, GEO.epochMs)!.geodetic;

    it('is always above the mask from under the satellite', () => {
      const under: ObserverLocation = { latitudeDeg: 0, longitudeDeg: sub.longitudeDeg, altitudeM: 0, source: 'manual' };
      const r = predictPasses(geo, under, opts({ startMs: GEO.epochMs, searchDays: 1, scanStepS: 120 }), GEO.noradId);
      expect(r.status).toBe('always-above-mask');
      expect(r.passes).toHaveLength(0);
      expect(r.highestSampledElevationDeg).toBeGreaterThan(80);
    });

    it('never rises from the far side of the Earth', () => {
      const far: ObserverLocation = {
        latitudeDeg: 0,
        longitudeDeg: sub.longitudeDeg > 0 ? sub.longitudeDeg - 180 : sub.longitudeDeg + 180,
        altitudeM: 0,
        source: 'manual',
      };
      const r = predictPasses(geo, far, opts({ startMs: GEO.epochMs, searchDays: 1, scanStepS: 120 }), GEO.noradId);
      expect(r.status).toBe('never-above-mask');
    });
  });

  it('reports a propagation error instead of passes for decayed elements', () => {
    // Very high drag: SGP4 reports decay well before 200 days from epoch.
    const decaying = createSatrec({
      line1: withChecksum('1 99002U 26001A   26320.50000000  .05000000  00000-0  50000-1 0  999'),
      line2: withChecksum('2 99002  51.6000 120.0000 0005000  90.0000 270.0000 16.2000000000001'),
    });
    const r = predictPasses(decaying, boulder, opts({ startMs: POLAR.epochMs + 200 * 86_400_000 }), 99002);
    expect(r.status).toBe('propagation-error');
    expect(r.error).toMatch(/decay|SGP4|eccentricity|semi-latus/);
    expect(r.passes).toHaveLength(0);
  });
});

describe('pass helpers', () => {
  it('maps azimuths to compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(44)).toBe('NE');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(292.5, 16)).toBe('WNW');
    expect(compassPoint(-90)).toBe('W');
  });

  it('describes the direction of travel', () => {
    expect(passDirection({ aosAzimuthDeg: 200, losAzimuthDeg: 30 })).toEqual({ from: 'S', to: 'NE', heading: 'northbound' });
    expect(passDirection({ aosAzimuthDeg: 340, losAzimuthDeg: 160 }).heading).toBe('southbound');
    expect(passDirection({ aosAzimuthDeg: 260, losAzimuthDeg: 100 }).heading).toBe('eastbound');
  });

  it('picks the pass in progress, else the next one', () => {
    const passes = [
      { aosMs: 100, losMs: 200 },
      { aosMs: 300, losMs: 400 },
    ];
    expect(currentOrNextPass(passes, 50)).toBe(passes[0]!);
    expect(currentOrNextPass(passes, 150)).toBe(passes[0]!);
    expect(currentOrNextPass(passes, 200)).toBe(passes[1]!);
    expect(currentOrNextPass(passes, 400)).toBeNull();
  });
});
