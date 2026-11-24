#!/usr/bin/env node
/**
 * Builds src/data/places.json, the bundled offline place list used by the
 * observer location search. Source: GeoNames (https://www.geonames.org/),
 * CC BY 4.0. Download these three files into one directory first:
 *
 *   https://download.geonames.org/export/dump/cities15000.zip  (unzip it)
 *   https://download.geonames.org/export/dump/admin1CodesASCII.txt
 *   https://download.geonames.org/export/dump/countryInfo.txt
 *
 * Usage: node scripts/build-places.mjs <geonames-dir> [min-population]
 *
 * Keeps every place with population >= min-population (default 100 000) plus
 * every national capital. Elevation is GeoNames' surveyed elevation when
 * present, otherwise its DEM value (SRTM3 / GTOPO30), both meters above mean
 * sea level.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, minPopArg] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/build-places.mjs <geonames-dir> [min-population]');
  process.exit(1);
}
const minPop = Number(minPopArg ?? 100_000);

const lines = (file) =>
  readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'));

const countries = {};
for (const l of lines('countryInfo.txt')) {
  const c = l.split('\t');
  countries[c[0]] = c[4];
}
const admin1 = new Map();
for (const l of lines('admin1CodesASCII.txt')) {
  const c = l.split('\t');
  admin1.set(c[0], c[2]);
}

const rows = [];
for (const l of lines('cities15000.txt')) {
  const c = l.split('\t');
  const population = Number(c[14]) || 0;
  const capital = c[7] === 'PPLC';
  if (population < minPop && !capital) continue;
  const elevation = c[15] !== '' ? Number(c[15]) : Number(c[16]);
  rows.push({
    name: c[1],
    ascii: c[2],
    cc: c[8],
    admin: admin1.get(`${c[8]}.${c[10]}`) ?? '',
    lat: Number(Number(c[4]).toFixed(4)),
    lon: Number(Number(c[5]).toFixed(4)),
    // -9999 is GeoNames' "no data" (ocean); fall back to sea level.
    elev: Number.isFinite(elevation) && elevation > -500 ? Math.round(elevation) : 0,
    population,
  });
}
rows.sort((a, b) => b.population - a.population);

const usedCountries = {};
for (const r of rows) usedCountries[r.cc] = countries[r.cc] ?? r.cc;

// Compact rows, most populous first: [name, asciiName ("" when equal), countryCode, admin1, lat, lon, elevM]
const out = {
  source: 'GeoNames cities15000 (https://www.geonames.org/), CC BY 4.0',
  minPopulation: minPop,
  countries: usedCountries,
  places: rows.map((r) => [r.name, r.ascii === r.name ? "" : r.ascii, r.cc, r.admin, r.lat, r.lon, r.elev]),
};
const target = new URL('../src/data/places.json', import.meta.url);
writeFileSync(target, JSON.stringify(out));
console.log(`wrote ${rows.length} places to ${target.pathname}`);
