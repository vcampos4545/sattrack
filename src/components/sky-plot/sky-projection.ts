/**
 * Polar sky-plot projection. Pure functions, no React, so they are unit tested.
 *
 * Conventional sky-plot orientation, as seen looking up from the ground with
 * north at the top of the screen:
 *   center = zenith (90 deg), outer circle = horizon (0 deg)
 *   north = up, east = right, south = down, west = left
 *
 * The radius is linear in zenith angle (azimuthal equidistant projection):
 *   r = R * (90 - el) / 90
 *   x =  r * sin(az)        (screen x grows to the right = east)
 *   y = -r * cos(az)        (screen y grows downward, so north is negative y)
 *
 * East-right looks mirrored compared with a map. That is the standard for
 * ground-station sky plots (and what an antenna rotator display expects),
 * and is what the spec asks for.
 */

export interface PlotPoint {
  x: number;
  y: number;
}

export interface TimedPlotPoint extends PlotPoint {
  timeMs: number;
}

/** Screen offset from the plot center of a direction, for horizon radius `radius`. */
export function projectAzEl(azimuthDeg: number, elevationDeg: number, radius: number): PlotPoint {
  const r = (radius * (90 - elevationDeg)) / 90;
  const az = (azimuthDeg * Math.PI) / 180;
  return { x: r * Math.sin(az), y: -r * Math.cos(az) };
}

/** Radius of the ring for an elevation, same scale as `projectAzEl`. */
export function elevationRadius(elevationDeg: number, radius: number): number {
  return (radius * (90 - elevationDeg)) / 90;
}

interface AzElSample {
  timeMs: number;
  azimuthDeg: number;
  elevationDeg: number;
}

/**
 * Projects a time-ordered track and keeps only the parts at or above
 * `minElevationDeg`, as separate polylines. Where the track crosses that
 * elevation, a point is interpolated on the crossing so segments end cleanly
 * on the horizon ring instead of at the last sample above it.
 *
 * Interpolation happens in screen space, not in azimuth, so it never has to
 * deal with the 359 -> 0 degree wrap. Over one sample step the error is a
 * small fraction of a pixel.
 */
export function visibleSegments(
  samples: readonly AzElSample[],
  radius: number,
  minElevationDeg = 0,
): TimedPlotPoint[][] {
  const segments: TimedPlotPoint[][] = [];
  let current: TimedPlotPoint[] | null = null;
  let prev: AzElSample | null = null;
  const at = (s: AzElSample): TimedPlotPoint => ({ ...projectAzEl(s.azimuthDeg, s.elevationDeg, radius), timeMs: s.timeMs });

  for (const s of samples) {
    const up = s.elevationDeg >= minElevationDeg;
    if (up) {
      if (!current) {
        current = [];
        if (prev) current.push(crossing(prev, s, minElevationDeg, radius));
      }
      current.push(at(s));
    } else if (current) {
      // `current` is open, so `prev` was above.
      if (prev) current.push(crossing(prev, s, minElevationDeg, radius));
      segments.push(current);
      current = null;
    }
    prev = s;
  }
  if (current) segments.push(current);
  return segments;
}

function crossing(a: AzElSample, b: AzElSample, minEl: number, radius: number): TimedPlotPoint {
  const f = (minEl - a.elevationDeg) / (b.elevationDeg - a.elevationDeg);
  const pa = projectAzEl(a.azimuthDeg, a.elevationDeg, radius);
  const pb = projectAzEl(b.azimuthDeg, b.elevationDeg, radius);
  return {
    x: pa.x + (pb.x - pa.x) * f,
    y: pa.y + (pb.y - pa.y) * f,
    timeMs: a.timeMs + (b.timeMs - a.timeMs) * f,
  };
}

export interface ArrowMark extends PlotPoint {
  /** Direction of travel, degrees, screen convention (0 = +x, clockwise positive). */
  angleDeg: number;
}

/**
 * Evenly spaced direction-of-travel marks along a polyline: one every
 * `spacing` pixels of path length, starting half a spacing in. Polylines
 * shorter than `minLength` get none (a stub is too short to read).
 */
export function arrowMarks(points: readonly PlotPoint[], spacing: number, minLength = spacing / 2): ArrowMark[] {
  if (points.length < 2 || !(spacing > 0)) return [];
  // Segment i runs from points[i] to points[i + 1].
  const segs: Array<{ a: PlotPoint; b: PlotPoint; length: number }> = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ a, b, length });
    total += length;
  }
  if (total < minLength) return [];
  const marks: ArrowMark[] = [];
  const count = Math.max(1, Math.floor(total / spacing));
  // Center the marks along the path.
  const first = (total - (count - 1) * spacing) / 2;
  let k = 0;
  let segStart = 0;
  for (const { a, b, length } of segs) {
    while (k < count && first + k * spacing <= segStart + length) {
      const f = length > 0 ? (first + k * spacing - segStart) / length : 0;
      marks.push({
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        angleDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      });
      k++;
    }
    segStart += length;
  }
  return marks;
}

/** SVG path data for a polyline. */
export function polylinePath(points: readonly PlotPoint[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
}
