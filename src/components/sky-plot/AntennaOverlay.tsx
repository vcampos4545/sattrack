import type { AntennaPointing, AzEl } from '../../types/antenna';
import { projectAzEl } from './sky-projection';

/** Overlay colors: commanded (dashed) and actual (solid) antenna pointing. */
export const ANTENNA_COLORS = { commanded: '#f2b84b', actual: '#e2e8f0' } as const;

interface AntennaOverlayProps {
  antenna: AntennaPointing;
  /** Satellite direction now, to draw the pointing-error leg from the actual pointing. */
  target: AzEl | null;
  radius: number;
}

/**
 * Antenna pointing markers on the sky plot. Display only: nothing here talks
 * to hardware. A rotator controller supplies `AntennaPointing` through
 * `SkyPlot`'s `antenna` prop. Directions below the horizon are clamped to the
 * horizon ring so a parked or faulted rotator is still visible.
 */
export function AntennaOverlay({ antenna, target, radius }: AntennaOverlayProps) {
  const at = (p: AzEl) => projectAzEl(p.azimuthDeg, Math.max(0, p.elevationDeg), radius);
  const { commanded, actual } = antenna;
  return (
    <g>
      {actual && target && target.elevationDeg >= 0 && (
        <line
          x1={at(actual).x}
          y1={at(actual).y}
          x2={at(target).x}
          y2={at(target).y}
          stroke={ANTENNA_COLORS.actual}
          strokeWidth={0.75}
          strokeDasharray="1.5 2"
          opacity={0.7}
        />
      )}
      {commanded && (
        <g transform={`translate(${at(commanded).x} ${at(commanded).y})`}>
          <title>{`Commanded az ${commanded.azimuthDeg.toFixed(1)}° el ${commanded.elevationDeg.toFixed(1)}°`}</title>
          <circle r={5} fill="none" stroke={ANTENNA_COLORS.commanded} strokeWidth={1} strokeDasharray="2 1.5" />
          <path d="M-7 0 H-3 M3 0 H7 M0 -7 V-3 M0 3 V7" stroke={ANTENNA_COLORS.commanded} strokeWidth={1} />
        </g>
      )}
      {actual && (
        <g transform={`translate(${at(actual).x} ${at(actual).y})`}>
          <title>{`Antenna az ${actual.azimuthDeg.toFixed(1)}° el ${actual.elevationDeg.toFixed(1)}°`}</title>
          <circle r={3.5} fill="none" stroke={ANTENNA_COLORS.actual} strokeWidth={1.25} />
          <path d="M-2 -2 L2 2 M-2 2 L2 -2" stroke={ANTENNA_COLORS.actual} strokeWidth={1} />
        </g>
      )}
    </g>
  );
}
