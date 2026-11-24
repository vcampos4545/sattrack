import { useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';
import { geodeticToEcef } from '../../core/orbit/coordinate-transformations';
import { writeSceneFromKm } from './scene-frame';

const GRID_STEP_DEG = 15;
const SEGMENT_DEG = 2;
/** Height of the grid lines, km. Keeps them above the tessellated surface. */
const GRID_ALTITUDE_KM = 8;

/** Line-segment geometry following WGS84 parallels and meridians. */
function buildGrid(filter: (kind: 'lat' | 'lon', deg: number) => boolean): BufferGeometry {
  const pts: number[] = [];
  const push = (lat: number, lon: number) => {
    const p = geodeticToEcef({ latitudeDeg: lat, longitudeDeg: lon, altitudeKm: GRID_ALTITUDE_KM });
    const o = pts.length;
    pts.push(0, 0, 0);
    writeSceneFromKm(p.x, p.y, p.z, pts, o);
  };
  for (let lat = -90 + GRID_STEP_DEG; lat < 90; lat += GRID_STEP_DEG) {
    if (!filter('lat', lat)) continue;
    for (let lon = -180; lon < 180; lon += SEGMENT_DEG) {
      push(lat, lon);
      push(lat, lon + SEGMENT_DEG);
    }
  }
  for (let lon = -180; lon < 180; lon += GRID_STEP_DEG) {
    if (!filter('lon', lon)) continue;
    for (let lat = -90; lat < 90; lat += SEGMENT_DEG) {
      push(lat, lon);
      push(lat + SEGMENT_DEG, lon);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  return g;
}

/**
 * Latitude/longitude graticule every 15 degrees, Earth-fixed (place inside
 * `EarthFixedFrame`). The equator and prime meridian are drawn brighter so
 * orientation is readable at a glance.
 */
export function LatLonGrid() {
  const [minor, major] = useMemo(() => {
    const isMajor = (_kind: 'lat' | 'lon', deg: number) => deg === 0;
    return [buildGrid((k, d) => !isMajor(k, d)), buildGrid(isMajor)];
  }, []);
  return (
    <group>
      <lineSegments geometry={minor}>
        <lineBasicMaterial color="#9fb4d6" transparent opacity={0.13} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={major}>
        <lineBasicMaterial color="#c4d4ee" transparent opacity={0.32} depthWrite={false} />
      </lineSegments>
    </group>
  );
}
