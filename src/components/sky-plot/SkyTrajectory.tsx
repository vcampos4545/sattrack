import { memo, useMemo } from 'react';
import type { PassTrackSample } from '../../types/passes';
import { arrowMarks, polylinePath, visibleSegments } from './sky-projection';

interface SkyTrajectoryProps {
  samples: readonly PassTrackSample[];
  /** Horizon radius in plot units. */
  radius: number;
  color: string;
  strokeWidth?: number;
  opacity?: number;
  dashed?: boolean;
  /** Pixel spacing of direction-of-travel arrows; omit for none. */
  arrowSpacing?: number;
}

/**
 * One sky track (az/el samples, time ordered) drawn on the polar plot.
 * Only the part above the horizon is drawn; arrows show the direction of
 * travel. Coordinates are relative to the plot center.
 */
export const SkyTrajectory = memo(function SkyTrajectory({
  samples,
  radius,
  color,
  strokeWidth = 1.5,
  opacity = 1,
  dashed = false,
  arrowSpacing,
}: SkyTrajectoryProps) {
  const segments = useMemo(() => visibleSegments(samples, radius), [samples, radius]);
  const arrows = useMemo(
    () => (arrowSpacing ? segments.flatMap((seg) => arrowMarks(seg, arrowSpacing)) : []),
    [segments, arrowSpacing],
  );
  if (segments.length === 0) return null;
  const head = 2.2 + strokeWidth;
  return (
    <g opacity={opacity}>
      {segments.map((seg, i) => (
        <path
          key={i}
          d={polylinePath(seg)}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dashed ? '3 3' : undefined}
        />
      ))}
      {arrows.map((a, i) => (
        <path
          key={`a${i}`}
          d={`M${-head} ${-head * 0.75} L${head * 0.6} 0 L${-head} ${head * 0.75}`}
          transform={`translate(${a.x.toFixed(2)} ${a.y.toFixed(2)}) rotate(${a.angleDeg.toFixed(1)})`}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
});
