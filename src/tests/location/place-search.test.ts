import { describe, expect, it } from 'vitest';
import placesJson from '../../data/places.json';
import {
  buildPlaceIndex,
  formatPlaceLabel,
  nearestPlace,
  normalizeSearchText,
  searchPlaces,
  type PlaceData,
} from '../../services/place-search';
import { validateObserverLocation } from '../../core/orbit/observer';

const index = buildPlaceIndex(placesJson as unknown as PlaceData);

describe('bundled place data', () => {
  it('has a few thousand valid observer locations with attribution', () => {
    expect(index.entries.length).toBeGreaterThan(5000);
    expect(index.source).toMatch(/GeoNames.*CC BY/);
    for (const { place } of index.entries) {
      const errors = validateObserverLocation({
        latitudeDeg: place.latitudeDeg,
        longitudeDeg: place.longitudeDeg,
        altitudeM: place.elevationM,
      });
      expect(errors, place.name).toEqual({});
    }
  });
});

describe('searchPlaces', () => {
  it('ranks an exact, populous match first', () => {
    const first = searchPlaces(index, 'Denver')[0]!;
    expect(first).toMatchObject({ name: 'Denver', countryCode: 'US', admin: 'Colorado' });
    // GeoNames: 39.7392, -104.9847, about 1600 m.
    expect(first.latitudeDeg).toBeCloseTo(39.7392, 3);
    expect(first.longitudeDeg).toBeCloseTo(-104.9847, 3);
    expect(first.elevationM).toBeGreaterThan(1500);
    expect(first.elevationM).toBeLessThan(1700);
  });

  it('matches without diacritics', () => {
    expect(searchPlaces(index, 'sao paulo')[0]).toMatchObject({ name: 'São Paulo', countryCode: 'BR' });
  });

  it('filters by a country or admin qualifier after a comma', () => {
    const us = searchPlaces(index, 'Portland, Oregon');
    expect(us[0]).toMatchObject({ name: 'Portland', admin: 'Oregon' });
    const fr = searchPlaces(index, 'Paris, FR');
    expect(fr[0]).toMatchObject({ name: 'Paris', countryCode: 'FR' });
    expect(fr.every((p) => p.countryCode === 'FR')).toBe(true);
  });

  it('finds word prefixes inside multi-word names', () => {
    expect(searchPlaces(index, 'york', 20).some((p) => p.name === 'New York City')).toBe(true);
  });

  it('needs at least two characters and respects the limit', () => {
    expect(searchPlaces(index, 'a')).toEqual([]);
    expect(searchPlaces(index, 'san', 5)).toHaveLength(5);
  });

  it('returns nothing for gibberish', () => {
    expect(searchPlaces(index, 'zzqxqz')).toEqual([]);
  });
});

describe('nearestPlace', () => {
  it('names a fix near a city', () => {
    // A point in downtown Tokyo.
    const r = nearestPlace(index, 35.69, 139.7);
    expect(r?.place.countryCode).toBe('JP');
    expect(r!.distanceKm).toBeLessThan(10);
  });

  it('handles the antimeridian', () => {
    // Suva, Fiji is at 178.44 E; approach it from the west side of the line.
    const r = nearestPlace(index, -18.14, 178.44, 50);
    expect(r?.place.countryCode).toBe('FJ');
  });

  it('returns null in the open ocean', () => {
    expect(nearestPlace(index, -40, -130)).toBeNull();
  });
});

describe('helpers', () => {
  it('normalizes text', () => {
    expect(normalizeSearchText('  Zürich,  CH ')).toBe('zurich ch');
  });

  it('formats labels without repeating a city-state admin', () => {
    expect(
      formatPlaceLabel({
        name: 'Singapore',
        admin: 'Singapore',
        country: 'Singapore',
        countryCode: 'SG',
        latitudeDeg: 1.29,
        longitudeDeg: 103.85,
        elevationM: 15,
      }),
    ).toBe('Singapore, Singapore');
  });
});
