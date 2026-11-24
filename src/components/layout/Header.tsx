import { MapPin, Satellite, Settings } from 'lucide-react';
import { useState } from 'react';
import { useObserverStore } from '../../stores/observer-store';
import { formatLatitude, formatLongitude } from '../../utils/format';
import { LocationSelector } from '../location/LocationSelector';
import { CatalogStatus } from '../satellite/CatalogStatus';
import { SatelliteSearch } from '../satellite/SatelliteSearch';
import { ErrorBoundary } from './ErrorBoundary';
import { SettingsMenu } from './SettingsMenu';

type Drawer = 'location' | 'settings' | null;

export function Header() {
  const [drawer, setDrawer] = useState<Drawer>(null);
  const location = useObserverStore((s) => s.location);
  const toggle = (d: Exclude<Drawer, null>) => setDrawer((cur) => (cur === d ? null : d));

  return (
    <header className="relative z-20 flex h-11 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
      <div className="flex items-center gap-2">
        <Satellite className="size-4 text-accent" aria-hidden />
        <span className="font-mono text-[13px] font-semibold tracking-[0.2em]">SATTRACK</span>
      </div>
      <div className="min-w-0 flex-1">
        <SatelliteSearch />
      </div>
      <CatalogStatus />
      <button
        type="button"
        onClick={() => toggle('location')}
        aria-expanded={drawer === 'location'}
        className={`flex items-center gap-2 border px-2 py-1 font-mono text-[11px] tabular hover:border-line-strong ${drawer === 'location' ? 'border-line-strong bg-panel-raised' : 'border-line'}`}
        title="Observer location"
      >
        <MapPin className={`size-3.5 ${location.source === 'default' ? 'text-warn' : 'text-accent'}`} aria-hidden />
        {formatLatitude(location.latitudeDeg, 2)} {formatLongitude(location.longitudeDeg, 2)}
      </button>
      <button
        type="button"
        onClick={() => toggle('settings')}
        aria-expanded={drawer === 'settings'}
        aria-label="Settings"
        className={`border p-1.5 hover:border-line-strong ${drawer === 'settings' ? 'border-line-strong bg-panel-raised' : 'border-line'}`}
      >
        <Settings className="size-3.5 text-muted" aria-hidden />
      </button>
      {drawer && (
        <div
          className={`absolute top-full right-4 mt-1 max-h-[calc(100vh-4rem)] overflow-y-auto border border-line-strong bg-panel-raised shadow-2xl shadow-black/50 ${drawer === 'settings' ? 'w-[380px]' : 'w-[360px]'}`}
        >
          <ErrorBoundary name={drawer === 'location' ? 'Location panel' : 'Settings'}>
            {drawer === 'location' ? <LocationSelector onClose={() => setDrawer(null)} /> : <SettingsMenu onClose={() => setDrawer(null)} />}
          </ErrorBoundary>
        </div>
      )}
    </header>
  );
}
