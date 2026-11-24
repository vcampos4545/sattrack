import { describe, expect, it } from 'vitest';
import { parseAltitude, parseCoordinate } from '../../utils/coordinate-input';

describe('parseCoordinate', () => {
  it.each([
    ['40.7128', 'lat', 40.7128],
    ['-74.006', 'lon', -74.006],
    ['+12.5', 'lat', 12.5],
    ['40.7128 N', 'lat', 40.7128],
    ['40.7128s', 'lat', -40.7128],
    ['74.006W', 'lon', -74.006],
    ['E 151.2093', 'lon', 151.2093],
    ['40,7128', 'lat', 40.7128],
    [`40°42'46"N`, 'lat', 40 + 42 / 60 + 46 / 3600],
    ['74° 0′ 21.6″ W', 'lon', -(74 + 21.6 / 3600)],
    ['40 42 46.1 N', 'lat', 40 + 42 / 60 + 46.1 / 3600],
    ['-33 52.1', 'lat', -(33 + 52.1 / 60)],
    ['180', 'lon', 180],
    ['0', 'lat', 0],
  ] as const)('%s (%s) -> %f', (input, axis, expected) => {
    expect(parseCoordinate(input, axis)).toBeCloseTo(expected, 9);
  });

  it.each([
    ['', 'lat'],
    ['   ', 'lat'],
    ['abc', 'lat'],
    ['40.7 E', 'lat'], // wrong axis letter
    ['74 N', 'lon'],
    ['-40 N', 'lat'], // sign and hemisphere together
    ['40 60 0', 'lat'], // minutes out of range
    ['40 30 75', 'lat'], // seconds out of range
    ['40.5 30', 'lat'], // fraction before the last component
    ['1 2 3 4', 'lat'],
    ['12..3', 'lat'],
  ] as const)('rejects %j (%s)', (input, axis) => {
    expect(parseCoordinate(input, axis)).toBeNaN();
  });

  it('leaves range checks to validation', () => {
    expect(parseCoordinate('95', 'lat')).toBe(95);
  });
});

describe('parseAltitude', () => {
  it('parses meters with an optional unit', () => {
    expect(parseAltitude('1609')).toBe(1609);
    expect(parseAltitude('-28.5 m')).toBe(-28.5);
  });

  it('rejects empty or non-numeric input', () => {
    expect(parseAltitude('')).toBeNaN();
    expect(parseAltitude('high')).toBeNaN();
    expect(parseAltitude('1e3')).toBeNaN();
  });
});
