import { describe, expect, it } from 'vitest';
import {
  computeGroundTrack,
  GROUND_TRACK_MAX_SPAN_MS,
  groundTrackHeadingDeg,
  groundTrackWindow,
  initialBearingDeg,
  splitAtAntimeridian,
  splitIndex,
  type GroundTrackPoint,
} from '../../core/orbit/ground-track';
import { computeSatelliteState } from '../../core/orbit/satellite-propagator';
import { satrecFor } from '../../core/orbit/sgp4';
import { parseTlePair, tleChecksum } from '../../core/orbit/tle-parser';

/** Appends a correct checksum to a 68-character TLE line body. */
function withChecksum(body: string): string {
  if (body.length !== 68) throw new Error(`TLE body must be 68 chars, got ${body.length}`);
  return body + tleChecksum(body);
}

const ISS = parseTlePair(
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
);

/** Synthetic sun-synchronous polar orbit (99.19 deg, ~850 km), NOAA-like. */
const POLAR = parseTlePair(
  'TEST POLAR',
  withChecksum('1 33591U 09005A   19156.50000000  .00000050  00000-0  52000-4 0  999'),
  withChecksum('2 33591  99.1914 123.4567 0013456 123.4567 236.7890 14.12345678 1234'),
);

/** Synthetic geostationary element set (same as propagator.test.ts). */
const GEO = parseTlePair(
  'TEST GEO',
  '1 41866U 16071A   26320.50000000 -.00000088  00000-0  00000-0 0  9995',
  '2 41866   0.0500  95.0000 0001000 270.0000  90.0000  1.00271000 30009',
);

const pt = (timeMs: number, latitudeDeg: number, longitudeDeg: number): GroundTrackPoint => ({
  timeMs,
  latitudeDeg,
  longitudeDeg,
  altitudeKm: 400,
});

describe('computeGroundTrack', () => {
  it('matches the propagated geodetic sub-satellite point at every sample', () => {
    const satrec = satrecFor(ISS);
    const track = computeGroundTrack(satrec, ISS.epochMs, ISS.epochMs + 600_000, 60_000);
    expect(track).toHaveLength(11);
    for (const p of track) {
      const s = computeSatelliteState(satrec, p.timeMs);
      expect(p.latitudeDeg).toBeCloseTo(s!.geodetic.latitudeDeg, 12);
      expect(p.longitudeDeg).toBeCloseTo(s!.geodetic.longitudeDeg, 12);
      expect(p.altitudeKm).toBeCloseTo(s!.geodetic.altitudeKm, 9);
    }
  });

  it('stays within the inclination band and drifts west each revolution (Earth rotation)', () => {
    const satrec = satrecFor(ISS);
    const periodMs = ISS.periodMin * 60_000;
    const track = computeGroundTrack(satrec, ISS.epochMs, ISS.epochMs + 3 * periodMs, 20_000);
    for (const p of track) {
      // Geodetic latitude peaks slightly above the 51.64 deg inclination.
      expect(Math.abs(p.latitudeDeg)).toBeLessThan(52);
      expect(p.longitudeDeg).toBeGreaterThan(-180);
      expect(p.longitudeDeg).toBeLessThanOrEqual(180);
    }
    const a = computeSatelliteState(satrec, ISS.epochMs)!.geodetic;
    const b = computeSatelliteState(satrec, ISS.epochMs + periodMs)!.geodetic;
    // Same orbital phase one period later: same latitude, shifted west by
    // ~ omega_earth * period (~23.2 deg) plus J2 nodal regression (~0.3 deg).
    expect(b.latitudeDeg).toBeCloseTo(a.latitudeDeg, 0);
    let shift = b.longitudeDeg - a.longitudeDeg;
    if (shift > 180) shift -= 360;
    if (shift < -180) shift += 360;
    expect(shift).toBeLessThan(-22.5);
    expect(shift).toBeGreaterThan(-24.5);
  });

  it('reaches high latitudes for a polar orbit without false date-line crossings', () => {
    const satrec = satrecFor(POLAR);
    const periodMs = POLAR.periodMin * 60_000;
    const track = computeGroundTrack(satrec, POLAR.epochMs, POLAR.epochMs + periodMs, 20_000);
    const maxLat = Math.max(...track.map((p) => p.latitudeDeg));
    const minLat = Math.min(...track.map((p) => p.latitudeDeg));
    // Retrograde 99.19 deg: max geodetic latitude ~ 180 - 99.19 = 80.8 deg.
    expect(maxLat).toBeGreaterThan(80);
    expect(maxLat).toBeLessThan(82);
    expect(minLat).toBeLessThan(-80);
    // One revolution crosses the antimeridian at most twice.
    const segments = splitAtAntimeridian(track);
    expect(segments.length).toBeLessThanOrEqual(3);
    for (const seg of segments) {
      for (let i = 1; i < seg.length; i++) {
        expect(Math.abs(seg[i]!.longitudeDeg - seg[i - 1]!.longitudeDeg)).toBeLessThan(180);
      }
    }
  });

  it('keeps a geostationary track within a fraction of a degree', () => {
    // Two sidereal days each way, capped at 24 h.
    const w = groundTrackWindow(GEO.periodMin, 2, 2);
    expect(w.futureMs).toBe(GROUND_TRACK_MAX_SPAN_MS);
    const track = computeGroundTrack(satrecFor(GEO), GEO.epochMs - w.pastMs, GEO.epochMs + w.futureMs, w.stepMs);
    const lats = track.map((p) => p.latitudeDeg);
    const lons = track.map((p) => p.longitudeDeg);
    expect(Math.max(...lats.map(Math.abs))).toBeLessThan(0.1);
    expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(0.5);
  });
});

describe('groundTrackWindow', () => {
  it('scales the step with the period and clamps it', () => {
    const iss = groundTrackWindow(92.7, 0.5, 1.5);
    expect(iss.stepMs).toBeCloseTo((92.7 * 60_000) / 240, 6);
    expect(iss.pastMs).toBeCloseTo(0.5 * 92.7 * 60_000, 6);
    expect(iss.futureMs).toBeCloseTo(1.5 * 92.7 * 60_000, 6);
    expect(groundTrackWindow(1436, 1, 1).stepMs).toBe(5 * 60_000);
    expect(groundTrackWindow(1, 1, 1).stepMs).toBe(10_000);
    expect(groundTrackWindow(Number.NaN, 1, 1).stepMs).toBeGreaterThan(0);
  });
});

describe('splitIndex', () => {
  const track = [pt(0, 0, 0), pt(10, 0, 1), pt(20, 0, 2), pt(30, 0, 3)];
  it('returns the first point after now', () => {
    expect(splitIndex(track, -1)).toBe(0);
    expect(splitIndex(track, 0)).toBe(1);
    expect(splitIndex(track, 15)).toBe(2);
    expect(splitIndex(track, 30)).toBe(4);
    expect(splitIndex([], 5)).toBe(0);
  });
});

describe('splitAtAntimeridian', () => {
  it('interpolates an eastward crossing at +180 / -180', () => {
    const segs = splitAtAntimeridian([pt(0, 10, 178), pt(10, 12, -178), pt(20, 14, -170)]);
    expect(segs).toHaveLength(2);
    const [a, b] = segs as [GroundTrackPoint[], GroundTrackPoint[]];
    expect(a.at(-1)!.longitudeDeg).toBe(180);
    expect(b[0]!.longitudeDeg).toBe(-180);
    // Halfway in unwrapped longitude (178 -> 182), so halfway in time and latitude.
    expect(a.at(-1)!.timeMs).toBeCloseTo(5, 9);
    expect(a.at(-1)!.latitudeDeg).toBeCloseTo(11, 9);
    expect(b[0]!.latitudeDeg).toBeCloseTo(11, 9);
    expect(b.map((p) => p.longitudeDeg)).toEqual([-180, -178, -170]);
  });

  it('interpolates a westward crossing at -180 / +180', () => {
    const segs = splitAtAntimeridian([pt(0, -5, -179), pt(10, -6, 177)]);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.at(-1)!.longitudeDeg).toBe(-180);
    expect(segs[1]![0]!.longitudeDeg).toBe(180);
    // 1 deg of a 4 deg step.
    expect(segs[0]!.at(-1)!.timeMs).toBeCloseTo(2.5, 9);
    expect(segs[0]!.at(-1)!.latitudeDeg).toBeCloseTo(-5.25, 9);
  });

  it('leaves tracks that do not cross the line untouched', () => {
    const track = [pt(0, 0, -10), pt(10, 1, 0), pt(20, 2, 10)];
    expect(splitAtAntimeridian(track)).toEqual([track]);
    expect(splitAtAntimeridian([])).toEqual([]);
  });

  it('handles a geostationary object oscillating across the line', () => {
    const segs = splitAtAntimeridian([pt(0, 0, 179.9), pt(1, 0, -179.9), pt(2, 0, 179.95)]);
    expect(segs).toHaveLength(3);
    for (const seg of segs) {
      for (let i = 1; i < seg.length; i++) expect(Math.abs(seg[i]!.longitudeDeg - seg[i - 1]!.longitudeDeg)).toBeLessThan(1);
    }
  });

  it('splits a real ISS track crossing the date line', () => {
    const satrec = satrecFor(ISS);
    const track = computeGroundTrack(satrec, ISS.epochMs, ISS.epochMs + 2 * ISS.periodMin * 60_000, 30_000);
    const segs = splitAtAntimeridian(track);
    expect(segs.length).toBeGreaterThan(1);
    for (let s = 0; s < segs.length - 1; s++) {
      const end = segs[s]!.at(-1)!;
      const start = segs[s + 1]![0]!;
      expect(Math.abs(end.longitudeDeg)).toBe(180);
      expect(start.longitudeDeg).toBe(-end.longitudeDeg);
      expect(start.latitudeDeg).toBe(end.latitudeDeg);
    }
    // ISS is prograde: it crosses eastward, from +180 to -180.
    expect(segs[0]!.at(-1)!.longitudeDeg).toBe(180);
  });
});

describe('initialBearingDeg', () => {
  it('gives compass bearings', () => {
    expect(initialBearingDeg({ latitudeDeg: 0, longitudeDeg: 0 }, { latitudeDeg: 1, longitudeDeg: 0 })).toBeCloseTo(0, 9);
    expect(initialBearingDeg({ latitudeDeg: 0, longitudeDeg: 0 }, { latitudeDeg: 0, longitudeDeg: 1 })).toBeCloseTo(90, 9);
    expect(initialBearingDeg({ latitudeDeg: 0, longitudeDeg: 0 }, { latitudeDeg: -1, longitudeDeg: 0 })).toBeCloseTo(180, 9);
    expect(initialBearingDeg({ latitudeDeg: 0, longitudeDeg: 0 }, { latitudeDeg: 0, longitudeDeg: -1 })).toBeCloseTo(270, 9);
  });

  it('is continuous across the date line', () => {
    expect(initialBearingDeg({ latitudeDeg: 0, longitudeDeg: 179.5 }, { latitudeDeg: 0, longitudeDeg: -179.5 })).toBeCloseTo(90, 9);
  });
});

describe('groundTrackHeadingDeg', () => {
  it('points along the ground track (bearing to the sub-point a few seconds later)', () => {
    const satrec = satrecFor(ISS);
    for (let m = 0; m < 92; m += 7) {
      const t = ISS.epochMs + m * 60_000;
      const now = computeSatelliteState(satrec, t)!;
      const later = computeSatelliteState(satrec, t + 2_000)!;
      const heading = groundTrackHeadingDeg(now);
      const bearing = initialBearingDeg(now.geodetic, later.geodetic);
      let diff = Math.abs(heading - bearing);
      if (diff > 180) diff = 360 - diff;
      expect(diff).toBeLessThan(0.3);
    }
  });

  it('is northeast-bound on an ascending ISS pass at the equator', () => {
    // Prograde 51.6 deg orbit: ascending node heading ~ 90 - 51.6 + Earth-rotation tilt.
    const satrec = satrecFor(ISS);
    const track = computeGroundTrack(satrec, ISS.epochMs, ISS.epochMs + ISS.periodMin * 60_000, 5_000);
    const i = track.findIndex((p, k) => k > 0 && track[k - 1]!.latitudeDeg < 0 && p.latitudeDeg >= 0);
    const state = computeSatelliteState(satrec, track[i]!.timeMs)!;
    const heading = groundTrackHeadingDeg(state);
    expect(heading).toBeGreaterThan(35);
    expect(heading).toBeLessThan(60);
  });
});
