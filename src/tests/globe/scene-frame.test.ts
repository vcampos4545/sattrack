/**
 * Checks that the globe draws satellites over the right ground point. Uses
 * Three.js math (no WebGL, no React) to verify the scene mapping against the
 * real SphereGeometry the Earth texture is applied to.
 */
import { SphereGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { WGS84_A_KM } from '../../core/orbit/constants';
import { ecefPositionToTeme, geodeticToEcef } from '../../core/orbit/coordinate-transformations';
import { computeSatelliteState } from '../../core/orbit/satellite-propagator';
import { satrecFor } from '../../core/orbit/sgp4';
import { parseTlePair } from '../../core/orbit/tle-parser';
import { kmFromScene, rotateSceneY, sceneFromKm } from '../../components/globe/scene-frame';

const ISS = parseTlePair(
  'ISS (ZARYA)',
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
);

describe('scene frame mapping', () => {
  it('is a proper rotation scaled by the equatorial radius', () => {
    const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 12));
    close(sceneFromKm({ x: WGS84_A_KM, y: 0, z: 0 }), [1, 0, 0]);
    close(sceneFromKm({ x: 0, y: 0, z: WGS84_A_KM }), [0, 1, 0]); // north pole up
    close(sceneFromKm({ x: 0, y: WGS84_A_KM, z: 0 }), [0, 0, -1]); // lon 90 E toward -z
    const ex = new Vector3(...sceneFromKm({ x: 1, y: 0, z: 0 }));
    const ey = new Vector3(...sceneFromKm({ x: 0, y: 1, z: 0 }));
    const ez = new Vector3(...sceneFromKm({ x: 0, y: 0, z: 1 }));
    // Right-handed: x cross y = z survives the mapping.
    expect(ex.clone().cross(ey).normalize().distanceTo(ez.clone().normalize())).toBeLessThan(1e-12);
  });

  it('round-trips km -> scene -> km', () => {
    const v = { x: 1234.5, y: -6789.1, z: 42.42 };
    const back = kmFromScene(sceneFromKm(v));
    expect(back.x).toBeCloseTo(v.x, 9);
    expect(back.y).toBeCloseTo(v.y, 9);
    expect(back.z).toBeCloseTo(v.z, 9);
  });

  it('rotating the Earth group by GMST equals the TEME <-> ECEF transform', () => {
    const gmst = 1.2345;
    const ecef = geodeticToEcef({ latitudeDeg: 35, longitudeDeg: -120, altitudeKm: 400 });
    const viaGroup = rotateSceneY(sceneFromKm(ecef), gmst);
    const viaCore = sceneFromKm(ecefPositionToTeme(ecef, gmst));
    for (let i = 0; i < 3; i++) expect(viaGroup[i]).toBeCloseTo(viaCore[i]!, 12);
  });

  it('matches Three.js SphereGeometry UVs: texture longitude/latitude sit under the same scene direction', () => {
    // An equirectangular texture has lon = -180 + 360 u and lat = -90 + 180 v.
    const geo = new SphereGeometry(1, 72, 36);
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    let checked = 0;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (v <= 0.01 || v >= 0.99) continue; // poles: longitude undefined
      const lon = -180 + 360 * u;
      const lat = -90 + 180 * v;
      // Unit sphere direction for that lat/lon in ECEF, mapped to the scene.
      const r = Math.PI / 180;
      const expected = sceneFromKm({
        x: WGS84_A_KM * Math.cos(lat * r) * Math.cos(lon * r),
        y: WGS84_A_KM * Math.cos(lat * r) * Math.sin(lon * r),
        z: WGS84_A_KM * Math.sin(lat * r),
      });
      expect(pos.getX(i)).toBeCloseTo(expected[0], 6);
      expect(pos.getY(i)).toBeCloseTo(expected[1], 6);
      expect(pos.getZ(i)).toBeCloseTo(expected[2], 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('draws a propagated satellite above its computed sub-satellite point', () => {
    const t = ISS.epochMs + 45 * 60_000;
    const s = computeSatelliteState(satrecFor(ISS), t)!;
    // Satellite: TEME position in the (inertial) scene.
    const sat = new Vector3(...sceneFromKm(s.teme.positionKm)).normalize();
    // Ground point under it: geodetic sub-point, Earth-fixed, rotated by GMST
    // like the Earth group. Directions agree to within the geodetic vs
    // geocentric latitude difference (< 0.2 deg).
    const ground = geodeticToEcef({ ...s.geodetic, altitudeKm: 0 });
    const g = new Vector3(...rotateSceneY(sceneFromKm(ground), s.gmstRad)).normalize();
    expect((sat.angleTo(g) * 180) / Math.PI).toBeLessThan(0.2);
  });
});
