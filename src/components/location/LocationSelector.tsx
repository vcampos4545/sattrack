import { Loader2, LocateFixed, MapPin, RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { validateObserverLocation } from '../../core/orbit/observer';
import { detectLocation } from '../../services/geolocation';
import {
  formatPlaceLabel,
  loadPlaceIndex,
  nearestPlace,
  searchPlaces,
  type Place,
  type PlaceIndex,
} from '../../services/place-search';
import { DEFAULT_OBSERVER, useObserverStore } from '../../stores/observer-store';
import type { ObserverLocation, ObserverValidationErrors } from '../../types/observer';
import { parseAltitude, parseCoordinate } from '../../utils/coordinate-input';
import { formatLatitude, formatLongitude } from '../../utils/format';

type Notice = { tone: 'ok' | 'warn' | 'danger'; text: string } | null;

const SOURCE_LABEL: Record<ObserverLocation['source'], string> = {
  default: 'Default',
  manual: 'Manual',
  geolocation: 'Detected',
};

/**
 * Observer location panel (header drawer): shows the configured location,
 * detects it with the browser Geolocation API, searches a bundled offline
 * place list, and takes manual latitude/longitude/altitude entry. All writes
 * go through `useObserverStore.setLocation`, which validates and persists.
 */
export function LocationSelector({ onClose }: { onClose: () => void }) {
  const location = useObserverStore((s) => s.location);
  const setLocation = useObserverStore((s) => s.setLocation);
  const resetLocation = useObserverStore((s) => s.resetLocation);
  const [notice, setNotice] = useState<Notice>(null);
  const [detecting, setDetecting] = useState(false);

  const apply = (next: ObserverLocation, message: Notice): ObserverValidationErrors => {
    const errors = setLocation(next);
    if (Object.keys(errors).length === 0) setNotice(message);
    return errors;
  };

  const detect = async () => {
    setDetecting(true);
    setNotice(null);
    const fix = await detectLocation();
    if (!fix.ok) {
      setDetecting(false);
      setNotice({ tone: fix.reason === 'timeout' || fix.reason === 'unavailable' ? 'warn' : 'danger', text: fix.message });
      return;
    }
    // Name the fix after the nearest bundled place; if the browser gave no
    // altitude, that place's elevation is a better estimate than keeping the
    // previous location's altitude. Either way the notice says which it was.
    let near: ReturnType<typeof nearestPlace> = null;
    try {
      near = nearestPlace(await loadPlaceIndex(), fix.latitudeDeg, fix.longitudeDeg);
    } catch {
      near = null;
    }
    setDetecting(false);
    let altitudeM = location.altitudeM;
    let altNote = `Browser reported no altitude; kept ${location.altitudeM.toFixed(0)} m. Edit it below if needed.`;
    if (fix.altitudeM != null) {
      altitudeM = fix.altitudeM;
      altNote = 'Altitude from device.';
    } else if (near) {
      altitudeM = near.place.elevationM;
      altNote = `Altitude estimated from ${near.place.name} (${near.place.elevationM} m above sea level). Edit it below if needed.`;
    }
    apply(
      {
        latitudeDeg: fix.latitudeDeg,
        longitudeDeg: fix.longitudeDeg,
        altitudeM,
        label: near ? `Near ${shortPlaceLabel(near.place)}` : undefined,
        source: 'geolocation',
      },
      { tone: 'ok', text: `Location detected (±${formatAccuracy(fix.accuracyM)}). ${altNote}` },
    );
  };

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Observer location</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>

      <CurrentLocation location={location} />

      <button
        type="button"
        onClick={detect}
        disabled={detecting}
        className="mt-3 flex w-full items-center justify-center gap-2 border border-line-strong bg-panel py-1.5 text-[12px] hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-60"
      >
        {detecting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <LocateFixed className="size-3.5" aria-hidden />}
        {detecting ? 'Waiting for browser location…' : 'Detect My Location'}
      </button>
      {notice && (
        <p
          role="status"
          className={`mt-2 text-[11px] leading-relaxed ${notice.tone === 'ok' ? 'text-ok' : notice.tone === 'warn' ? 'text-warn' : 'text-danger'}`}
        >
          {notice.text}
        </p>
      )}

      <PlaceSearch
        onPick={(p) =>
          apply(
            {
              latitudeDeg: p.latitudeDeg,
              longitudeDeg: p.longitudeDeg,
              altitudeM: p.elevationM,
              label: shortPlaceLabel(p),
              source: 'manual',
            },
            { tone: 'ok', text: `Set to ${formatPlaceLabel(p)} (city center, ${p.elevationM} m above sea level).` },
          )
        }
      />

      <ManualEntry location={location} onApply={(next) => apply(next, { tone: 'ok', text: 'Location updated.' })} />

      {location.source !== 'default' && (
        <button
          type="button"
          onClick={() => {
            resetLocation();
            setNotice({ tone: 'warn', text: `Reset to ${DEFAULT_OBSERVER.label}.` });
          }}
          className="mt-3 flex items-center gap-1.5 text-[11px] text-faint hover:text-ink"
        >
          <RotateCcw className="size-3" aria-hidden />
          Reset to default
        </button>
      )}
    </div>
  );
}

/** "Portland, Oregon" (admin division disambiguates same-named cities), else "Paris, FR". */
function shortPlaceLabel(p: Place): string {
  return `${p.name}, ${p.admin && p.admin !== p.name ? p.admin : p.countryCode}`;
}

function formatAccuracy(m: number): string {
  if (!Number.isFinite(m)) return '?';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function CurrentLocation({ location }: { location: ObserverLocation }) {
  const isDefault = location.source === 'default';
  return (
    <div className={`border px-3 py-2 ${isDefault ? 'border-warn/40 bg-warn/5' : 'border-line bg-panel'}`}>
      <div className="flex items-center gap-2">
        <MapPin className={`size-3.5 shrink-0 ${isDefault ? 'text-warn' : 'text-accent'}`} aria-hidden />
        <span className="min-w-0 truncate text-[12px]">{location.label ?? 'Unnamed location'}</span>
        <span
          className={`ml-auto shrink-0 border px-1 font-mono text-[10px] uppercase tracking-wider ${isDefault ? 'border-warn/50 text-warn' : 'border-line-strong text-muted'}`}
        >
          {SOURCE_LABEL[location.source]}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-2 font-mono text-[12px] tabular">
        <Readout label="Lat" value={formatLatitude(location.latitudeDeg, 4)} />
        <Readout label="Lon" value={formatLongitude(location.longitudeDeg, 4)} />
        <Readout label="Alt" value={`${location.altitudeM.toFixed(0)} m`} />
      </div>
      {isDefault && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-warn">
          Not configured. Passes and sky plot use this default until you set your location.
        </p>
      )}
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-sans text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className="truncate">{value}</div>
    </div>
  );
}

function PlaceSearch({ onPick }: { onPick: (p: Place) => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<PlaceIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();
  const requested = useRef(false);

  const ensureIndex = () => {
    if (requested.current) return;
    requested.current = true;
    loadPlaceIndex().then(
      (idx) => setIndex(idx),
      () => {
        requested.current = false;
        setLoadError('Could not load the place list.');
      },
    );
  };

  const results = index ? searchPlaces(index, query) : [];
  useEffect(() => setActive(0), [query]);

  const pick = (p: Place) => {
    onPick(p);
    setQuery('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const p = results[active];
      if (p) pick(p);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  };

  const showList = query.trim().length >= 2;

  return (
    <div className="mt-4 border-t border-line pt-3">
      <label htmlFor={`${listId}-input`} className="text-[11px] uppercase tracking-[0.12em] text-muted">
        Find a place
      </label>
      <div className="relative mt-1.5">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
        <input
          id={`${listId}-input`}
          type="search"
          value={query}
          onFocus={ensureIndex}
          onChange={(e) => {
            ensureIndex();
            setQuery(e.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder="City, optionally “, country” or “, state”"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList && results.length > 0}
          aria-controls={listId}
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          className="w-full border border-line bg-panel py-1 pr-2 pl-7 text-[12px] placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </div>
      {showList && (
        <ul id={listId} role="listbox" className="mt-1 max-h-52 overflow-y-auto border border-line bg-panel">
          {loadError ? (
            <li className="px-2 py-1.5 text-[11px] text-danger">{loadError}</li>
          ) : !index ? (
            <li className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-faint">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Loading place list…
            </li>
          ) : results.length === 0 ? (
            <li className="px-2 py-1.5 text-[11px] text-faint">
              No match. The offline list covers cities over 100 000 people and capitals; enter coordinates below.
            </li>
          ) : (
            results.map((p, i) => (
              <li
                key={`${p.name}-${p.latitudeDeg}-${p.longitudeDeg}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-baseline gap-2 px-2 py-1 ${i === active ? 'bg-panel-raised text-ink' : 'text-muted'}`}
              >
                <span className="min-w-0 truncate text-[12px]">
                  {p.name}
                  <span className="text-faint">{p.admin && p.admin !== p.name ? `, ${p.admin}` : ''}</span>
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">{p.countryCode}</span>
              </li>
            ))
          )}
        </ul>
      )}
      <p className="mt-1 text-[10px] text-faint">
        Offline list from{' '}
        <a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className="underline hover:text-muted">
          GeoNames
        </a>{' '}
        (CC BY 4.0). No network request.
      </p>
    </div>
  );
}

interface Draft {
  lat: string;
  lon: string;
  alt: string;
  label: string;
}

const toDraft = (loc: ObserverLocation): Draft => ({
  lat: String(Number(loc.latitudeDeg.toFixed(6))),
  lon: String(Number(loc.longitudeDeg.toFixed(6))),
  alt: String(Math.round(loc.altitudeM)),
  label: loc.source === 'default' ? '' : (loc.label ?? ''),
});

function ManualEntry({
  location,
  onApply,
}: {
  location: ObserverLocation;
  onApply: (next: ObserverLocation) => ObserverValidationErrors;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(location));
  const [errors, setErrors] = useState<ObserverValidationErrors>({});
  // Re-sync the form when the location changes elsewhere (detect, search, reset).
  const [synced, setSynced] = useState(location);
  if (synced !== location) {
    setSynced(location);
    setDraft(toDraft(location));
    setErrors({});
  }

  const parsed = {
    latitudeDeg: parseCoordinate(draft.lat, 'lat'),
    longitudeDeg: parseCoordinate(draft.lon, 'lon'),
    altitudeM: parseAltitude(draft.alt),
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fieldErrors = validateObserverLocation(parsed);
    if (Number.isNaN(parsed.latitudeDeg)) fieldErrors.latitudeDeg = 'Enter decimal degrees (40.7128, 40.7128 N) or 40°42′46″N';
    if (Number.isNaN(parsed.longitudeDeg)) fieldErrors.longitudeDeg = 'Enter decimal degrees (-74.006, 74.006 W) or 74°0′22″W';
    if (Number.isNaN(parsed.altitudeM)) fieldErrors.altitudeM = 'Enter a number of meters';
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    const label = draft.label.trim();
    onApply({ ...parsed, label: label || undefined, source: 'manual' });
  };

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value })),
  });
  const id = useId();
  const dirty =
    draft.lat !== toDraft(location).lat ||
    draft.lon !== toDraft(location).lon ||
    draft.alt !== toDraft(location).alt ||
    draft.label !== toDraft(location).label;

  return (
    <form onSubmit={submit} noValidate className="mt-4 border-t border-line pt-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Manual entry</div>
      <div className="mt-1.5 grid grid-cols-[4.5rem_1fr] items-start gap-x-2 gap-y-1.5">
        <CoordField id={`${id}-lat`} label="Latitude" unit="° N+" error={errors.latitudeDeg} {...field('lat')} />
        <CoordField id={`${id}-lon`} label="Longitude" unit="° E+" error={errors.longitudeDeg} {...field('lon')} />
        <CoordField id={`${id}-alt`} label="Altitude" unit="m" error={errors.altitudeM} {...field('alt')} />
        <label htmlFor={`${id}-label`} className="pt-1 text-[11px] text-faint">
          Name
        </label>
        <input
          id={`${id}-label`}
          {...field('label')}
          placeholder="optional"
          maxLength={60}
          className="w-full border border-line bg-panel px-2 py-1 text-[12px] placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <p className="text-[10px] leading-snug text-faint">Altitude: meters above the WGS84 ellipsoid (≈ sea level ± 100 m).</p>
        <button
          type="submit"
          disabled={!dirty}
          className="ml-auto shrink-0 border border-line-strong px-3 py-1 text-[12px] hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:text-ink"
        >
          Apply
        </button>
      </div>
    </form>
  );
}

function CoordField({
  id,
  label,
  unit,
  error,
  value,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  error?: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
}) {
  return (
    <>
      <label htmlFor={id} className="pt-1 text-[11px] text-faint">
        {label}
      </label>
      <div className="min-w-0">
        <div className="flex">
          <input
            id={id}
            value={value}
            onChange={onChange}
            inputMode="decimal"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            className={`w-full min-w-0 border bg-panel px-2 py-1 font-mono text-[12px] tabular focus:outline-none ${error ? 'border-danger focus:border-danger' : 'border-line focus:border-accent'}`}
          />
          <span className="flex w-10 shrink-0 items-center justify-center border border-l-0 border-line font-mono text-[10px] text-faint">
            {unit}
          </span>
        </div>
        {error && (
          <p id={`${id}-err`} className="mt-0.5 text-[11px] leading-snug text-danger">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
