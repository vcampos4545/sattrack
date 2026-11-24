import type { SatelliteCategory } from '../types/satellite';

/**
 * One color per category, shared by the globe markers, orbit lines, legends
 * and filters so a category reads the same everywhere.
 */
export const CATEGORY_COLORS: Record<SatelliteCategory, string> = {
  iss: '#ffd166',
  stations: '#f4a261',
  gnss: '#4cc2ff',
  weather: '#7bd88f',
  starlink: '#a78bfa',
  amateur: '#f472b6',
  science: '#5eead4',
  active: '#94a3b8',
  other: '#64748b',
};
