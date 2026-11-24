/**
 * Equirectangular Earth texture for the ground-track globe, drawn at runtime
 * from Natural Earth 1:110m land polygons (public domain,
 * https://www.naturalearthdata.com/). A vector source keeps the bundle small
 * (~75 KB, loaded lazily) and gives a crisp, map-like look suited to reading
 * a ground track, instead of a photographic texture.
 *
 * Canvas layout: x = (lon + 180) / 360 * W, y = (90 - lat) / 180 * H, which
 * matches Three.js SphereGeometry UVs (see scene-geometry.ts). Natural Earth
 * already splits polygons at the antimeridian, so no ring wraps the canvas.
 */
import { CanvasTexture, SRGBColorSpace } from 'three';

type Ring = [number, number][];
type Polygon = Ring[];

const WIDTH = 4096;
const HEIGHT = 2048;

const STYLE = {
  ocean: '#08111f',
  land: '#16233a',
  coast: '#3a4d6c',
  grid: 'rgba(124, 138, 161, 0.14)',
  gridMajor: 'rgba(124, 138, 161, 0.32)',
} as const;

let pending: Promise<CanvasTexture> | null = null;

/** Builds (once) and returns the shared land texture. */
export function loadLandTexture(): Promise<CanvasTexture> {
  pending ??= import('../../assets/geo/ne-110m-land.json').then((mod) => drawTexture(mod.default as Polygon[]));
  return pending;
}

function drawTexture(polygons: Polygon[]): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const x = (lon: number) => ((lon + 180) / 360) * WIDTH;
  const y = (lat: number) => ((90 - lat) / 180) * HEIGHT;

  ctx.fillStyle = STYLE.ocean;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Graticule every 15 degrees; equator and prime meridian slightly stronger.
  ctx.lineWidth = 2;
  for (let lon = -180; lon <= 180; lon += 15) {
    ctx.strokeStyle = lon === 0 ? STYLE.gridMajor : STYLE.grid;
    ctx.beginPath();
    ctx.moveTo(x(lon), 0);
    ctx.lineTo(x(lon), HEIGHT);
    ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    ctx.strokeStyle = lat === 0 ? STYLE.gridMajor : STYLE.grid;
    ctx.beginPath();
    ctx.moveTo(0, y(lat));
    ctx.lineTo(WIDTH, y(lat));
    ctx.stroke();
  }

  const path = new Path2D();
  for (const poly of polygons) {
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => (i === 0 ? path.moveTo(x(lon), y(lat)) : path.lineTo(x(lon), y(lat))));
      path.closePath();
    }
  }
  ctx.fillStyle = STYLE.land;
  ctx.fill(path, 'evenodd');
  ctx.strokeStyle = STYLE.coast;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke(path);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
