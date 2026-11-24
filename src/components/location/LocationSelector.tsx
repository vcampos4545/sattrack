import { X } from 'lucide-react';
import { useObserverStore } from '../../stores/observer-store';
import { formatLatitude, formatLongitude } from '../../utils/format';

/**
 * Slot: observer location panel (header drawer). Owned by the location task:
 * "Detect My Location" (geolocation), manual lat/lon/alt entry with
 * validation (`useObserverStore.setLocation` returns field errors).
 * Until then it shows the configured location, which is real persisted state.
 */
export function LocationSelector({ onClose }: { onClose: () => void }) {
  const location = useObserverStore((s) => s.location);
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Observer location</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[12px] tabular">
        <dt className="text-faint">Latitude</dt>
        <dd>{formatLatitude(location.latitudeDeg, 4)}</dd>
        <dt className="text-faint">Longitude</dt>
        <dd>{formatLongitude(location.longitudeDeg, 4)}</dd>
        <dt className="text-faint">Altitude</dt>
        <dd>{location.altitudeM.toFixed(0)} m</dd>
        <dt className="text-faint">Source</dt>
        <dd className={location.source === 'default' ? 'text-warn' : ''}>{location.label ?? location.source}</dd>
      </dl>
      <p className="mt-3 text-[11px] text-faint">Location detection and manual entry are not built yet (Phase 2).</p>
    </div>
  );
}
