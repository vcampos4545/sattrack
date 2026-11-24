# SatTrack

A local-first satellite tracking and ground station dashboard. It downloads real
orbital elements from [CelesTrak](https://celestrak.org/), propagates them with
SGP4 in the browser, and converts the results into Earth-fixed, geodetic and
observer-relative coordinates. There is no backend, account or API key.

This is the **foundation** build: project scaffold, dashboard shell, shared
types and stores, the CelesTrak catalog service, and the orbital mechanics
core with tests. The globe, location panel, ground track, passes, sky plot and
time controls are built on top of it as separate pieces of work (see
[Module contracts](#module-contracts)). Their panels currently say so instead
of showing placeholder data.

## Running locally

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest, core math and services
npm run build    # type-check + production build into dist/
```

On first launch the app downloads the default catalog groups (space stations,
weather, GPS operational, amateur radio, science; about 250 objects) and caches
them in IndexedDB. Later launches reuse the cache until it is older than the
auto-refresh interval (Settings, default 12 h). Manual refresh is in the header.

## Stack and why

| Concern | Choice | Reason |
|---|---|---|
| UI | React 19, TypeScript, Vite | Spec stack; fast dev server, strict typing. |
| 3D | Three.js + React Three Fiber (+ drei) | Spec stack; R3F keeps scene code declarative while allowing direct buffer/instancing access. |
| State | Zustand | Small, selector-based subscriptions, usable outside React (frame loops, services). |
| Styling | Tailwind CSS v4 | Design tokens in `src/index.css` (`@theme`). |
| SGP4 | [satellite.js](https://github.com/shashwatak/satellite-js) | Maintained port of Vallado's reference SGP4/SDP4. Verified here against Vallado's published vectors. We do not reimplement propagation. |
| Tests | Vitest | Runs the framework-free core in Node. |

`vite.config.ts` sets `worker.format = 'es'` because satellite.js re-exports an
optional WASM build whose worker needs ES-module output. That code is unused
and tree-shaken; the build prints harmless "externalized for browser
compatibility" warnings about it.

## Directory layout

```text
src/
  core/orbit/          Orbital mechanics. No React, no Three.js, no system clock.
    constants.ts       WGS84, Earth rotation rate, time constants
    time-utils.ts      UTC ms <-> Julian date, GMST (IAU-82), TLE epochs, epoch age
    tle-parser.ts      TLE parsing and validation (checksums, ranges, Alpha-5)
    sgp4.ts            satellite.js wrapper: SatRec creation/caching, TEME propagation
    coordinate-transformations.ts  TEME -> ECEF (PEF), ECEF <-> WGS84 geodetic, wrapping
    observer.ts        Observer validation, observer ECEF, ECEF -> ENU
    sky-coordinates.ts Azimuth, elevation, range, range rate
    satellite-propagator.ts  computeSatelliteState, propagateBatch, sampleTrajectory
  services/
    celestrak.ts       CelesTrak GP endpoints, group definitions, typed fetch errors
    satellite-catalog.ts  Cache-first catalog loading, validation, merging
    storage.ts         IndexedDB / localStorage with in-memory fallbacks
  stores/              Zustand stores (see contracts)
  hooks/               React glue: sim time, catalog bootstrap, selected satellite
  types/               Shared types: satellite, orbital, observer, passes
  components/          One slot file per dashboard panel (see contracts)
  utils/               Formatting, category colors
  tests/               Vitest suites: orbit/, coordinates/, services/, stores/
```

## Coordinate systems and units

| Quantity | Unit / convention |
|---|---|
| Time | UTC milliseconds since the Unix epoch (`number`). Local time only in display formatting. |
| Distance | kilometers in all core math. Observer altitude is stored in **meters** (UI unit) and converted at the boundary (`observerEcef`). |
| Velocity | km/s |
| Angles | radians inside `core/orbit` math; **degrees** in every exported type (`Geodetic`, `LookAngles`, `TleRecord`). |
| Longitude | (-180, 180], east positive (`wrapLongitudeDeg`). |
| Azimuth | [0, 360), clockwise from true north. Reported as 0 at the zenith, where it is undefined. |
| Elevation | Geometric, degrees above the local horizontal plane. No atmospheric refraction. |

### Transformation pipeline

```text
TLE --(satellite.js SGP4, WGS72)--> TEME r, v
TEME --(rotate about z by GMST)--> ECEF (PEF) r; v minus omega x r
ECEF --(WGS84, iterative)--> geodetic lat / lon / alt
ECEF - observer ECEF --(rotate to local axes)--> ENU
ENU --> azimuth = atan2(E, N), elevation = atan2(U, sqrt(E^2 + N^2))
range = |r_sat - r_obs|, range rate = (r_sat - r_obs) . v_sat / range
```

- **TEME** (True Equator, Mean Equinox) is SGP4's output frame, quasi-inertial.
- **ECEF** here is strictly **PEF** (Pseudo Earth Fixed): TEME rotated by
  Greenwich Mean Sidereal Time (IAU 1982 model). Two documented approximations:
  - **No polar motion** (PEF -> ITRF). Effect: up to about 15 m on the surface.
  - **UT1 approximated by UTC.** |UT1 - UTC| < 0.9 s, so up to about 0.4 km
    along the equator.

  Both are far below SGP4's own error (about 1 km at epoch, growing a few km
  per day). The test suite checks the result against Vallado's ITRF reference
  within 0.5 km, and against his PEF reference to sub-meter when UT1 is given.
- **Geodetic** coordinates use the WGS84 ellipsoid. SGP4 itself uses WGS72
  constants because TLEs are fit with them. That is correct and intentional:
  the two are used for different steps.
- **ENU** at the exact geographic poles: north is defined along the entered
  longitude's meridian, continued over the pole. Azimuths there are relative to
  that meridian.

### Element-set freshness

`classifyEpochAge` buckets |simulation time - TLE epoch|: under 3 days is
`fresh`, under 14 days is `aging`, otherwise `stale`. The selected-object strip
colors the epoch accordingly. Records that fail validation or SGP4
initialization are dropped and counted (`CatalogGroupStatus.rejectedCount`),
never silently fixed. Propagation failures (for example a decayed orbit) return
`null` / `ok: false` rather than a position.

## Module contracts

These are the interfaces later work builds on. Keep them stable or update this
section with the change.

**Time.** `stores/time-store.ts` is the only clock for orbital work.
`getSimTimeMs()` outside React, `useSimTimeMs(hz)` in components. Actions:
`pause`, `resume`, `setRate`, `jumpTo`, `step`, `resetToLive`. Store state
changes only when the clock is controlled, not per tick. Orbit code never calls
`Date.now()`. The only wall-clock uses are catalog data age and cache freshness,
which are about real downloads.

**Catalog and selection.** `stores/satellite-store.ts`:
- `satellites` (everything loaded), `tracked` (minus user-removed), `visible`
  (tracked and category filter on), `byId`. These are stable arrays recomputed
  in actions, so they are safe to subscribe to.
- `selectedId`, `select(id)`, `selectedPassId`, `selectPass(id)`. Changing the
  selection clears the pass. Use `selectSelectedSatellite` as the selector.
- `trackNoradId(id)` (downloads by catalog number if needed), `untrack(id)`,
  `setCategoryVisible`, `setGroupEnabled`, `loadCatalog({ force })`.
- Status: `loadState`, `loadError`, `groupStatus`, `lastLoadedAtMs`.

**Observer.** `stores/observer-store.ts`: `location: ObserverLocation`
(degrees, altitude in meters, `source` is `'default'` until the user sets one),
`setLocation(loc)` returns field errors from `validateObserverLocation` and only
stores valid input. Persisted.

**Settings.** `stores/settings-store.ts`: `elevationMaskDeg` (default 10),
`footprintMinElevationDeg`, `passCount`, `passSearchDays`, `passScanStepS`,
`showOrbits`, `orbitScope`, `orbitLengthPeriods`, `showLatLonGrid`,
`showTerminator`, `propagationHz` (default 1), `autoRefreshHours`.
`update(patch)` clamps values. Persisted.

**Orbit math.** Import from `core/orbit/*`, never from satellite.js directly:
- `satrecFor(tle)` returns a cached SGP4 record per `TleRecord` object.
- `computeSatelliteState(satrec, timeMs)` returns a `SatelliteState`
  (TEME, ECEF with true Earth-relative velocity, geodetic, inertial speed,
  GMST) or `null`.
- `propagateBatch(satrecs, timeMs, buffers)` writes TEME positions and
  velocities into `Float64Array`s for bulk rendering. It is worker-friendly:
  move it behind a Web Worker without changing callers' data layout.
- `sampleTrajectory(satrec, startMs, endMs, stepMs)` for orbit paths
  (`teme`) and ground tracks (`geodetic`).
- `computeLookAngles(ecefState, observer)` / `lookAnglesAt(satrec, observer, timeMs)`
  for az/el/range/range rate.
- `gmstRad(timeMs)` to rotate an Earth mesh into TEME, or TEME into ECEF.

**Passes.** `types/passes.ts` defines `Pass` (AOS/LOS/max-elevation times and
azimuths, duration, `track: PassTrackSample[]`) and its `id`
(`${noradId}-${aosMs}`), shared by the passes table and the sky plot.

**Dashboard slots.** Each panel is its own file. Replace the slot's contents and
leave `Dashboard.tsx` / `Header.tsx` alone:

| Slot | File |
|---|---|
| Primary globe | `components/globe/EarthGlobe.tsx` |
| Search | `components/satellite/SatelliteSearch.tsx` |
| Selected-object strip (working) | `components/satellite/SatelliteInfo.tsx` |
| Ground track and footprint | `components/ground-track/GroundTrackGlobe.tsx` |
| Sky plot | `components/sky-plot/SkyPlot.tsx` |
| Upcoming passes | `components/passes/UpcomingPasses.tsx` |
| Location panel (header drawer) | `components/location/LocationSelector.tsx` |
| Time controls bar | `components/layout/TimeControls.tsx` |

`CATEGORY_COLORS` (`utils/category-colors.ts`) is the shared palette for
categories across all views.

## Data source etiquette

CelesTrak regenerates GP data about every 2 hours and asks clients not to
download the same data more often. The catalog service enforces a 2-hour floor
even for manual refresh, shares one request between concurrent loads, and falls
back to cached data (with a visible warning) when a download fails. Large
groups (Starlink, all active satellites) are opt-in in Settings.

The app requests TLE format. Catalog numbers above 99999 use Alpha-5 encoding,
which the parser decodes. Moving to OMM JSON (`FORMAT=json`, supported by
`satellite.js`'s `json2satrec`) is the long-term path once the catalog
outgrows TLEs.
