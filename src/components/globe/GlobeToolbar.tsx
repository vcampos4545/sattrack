import { Grid3x3, Orbit, SunMoon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSettingsStore, type OrbitScope } from '../../stores/settings-store';
import { TrackedListButton, TrackedOnlyToggle } from '../satellite/TrackedList';

const LENGTH_CHOICES = [0.25, 0.5, 1, 2, 3, 5];

function Toggle({ on, onClick, icon: Icon, label }: { on: boolean; onClick: () => void; icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={label}
      className={`flex items-center gap-1 border px-1.5 py-0.5 text-[11px] hover:border-line-strong ${on ? 'border-line-strong bg-panel-raised text-ink' : 'border-line text-faint'}`}
    >
      <Icon className="size-3" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/** Globe display settings (persisted in the settings store) and the Tracked-list filter. */
export function GlobeToolbar() {
  const showOrbits = useSettingsStore((s) => s.showOrbits);
  const orbitScope = useSettingsStore((s) => s.orbitScope);
  const orbitLengthPeriods = useSettingsStore((s) => s.orbitLengthPeriods);
  const showLatLonGrid = useSettingsStore((s) => s.showLatLonGrid);
  const showTerminator = useSettingsStore((s) => s.showTerminator);
  const update = useSettingsStore((s) => s.update);
  const lengths = LENGTH_CHOICES.includes(orbitLengthPeriods)
    ? LENGTH_CHOICES
    : [...LENGTH_CHOICES, orbitLengthPeriods].sort((a, b) => a - b);

  return (
    <div className="flex items-center gap-1.5 font-mono">
      <TrackedOnlyToggle />
      <TrackedListButton />
      <span className="mx-0.5 h-4 w-px bg-line" />
      <Toggle on={showOrbits} onClick={() => update({ showOrbits: !showOrbits })} icon={Orbit} label="Orbits" />
      <select
        aria-label="Which orbits to draw"
        value={orbitScope}
        disabled={!showOrbits}
        onChange={(e) => update({ orbitScope: e.target.value as OrbitScope })}
        className="border border-line bg-panel px-1 py-0.5 text-[11px] disabled:opacity-40"
      >
        <option value="selected">Selected</option>
        <option value="all">All visible</option>
      </select>
      <select
        aria-label="Orbit length in periods"
        title="Orbit path length, in orbital periods"
        value={orbitLengthPeriods}
        disabled={!showOrbits}
        onChange={(e) => update({ orbitLengthPeriods: Number(e.target.value) })}
        className="border border-line bg-panel px-1 py-0.5 text-[11px] tabular disabled:opacity-40"
      >
        {lengths.map((l) => (
          <option key={l} value={l}>
            {l} rev
          </option>
        ))}
      </select>
      <span className="mx-0.5 h-4 w-px bg-line" />
      <Toggle on={showLatLonGrid} onClick={() => update({ showLatLonGrid: !showLatLonGrid })} icon={Grid3x3} label="Grid" />
      <Toggle on={showTerminator} onClick={() => update({ showTerminator: !showTerminator })} icon={SunMoon} label="Day/night" />
    </div>
  );
}
