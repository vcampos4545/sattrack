import { Star } from 'lucide-react';
import { useSatelliteStore } from '../../stores/satellite-store';

/** Adds an object to, or removes it from, the user's Tracked list (search rows, selected-object strip). */
export function TrackButton({ noradId, name }: { noradId: number; name: string }) {
  const tracked = useSatelliteStore((s) => s.trackedIds.includes(noradId));
  const { addTracked, removeTracked } = useSatelliteStore.getState();
  const label = tracked ? `Remove ${name} from the Tracked list` : `Add ${name} to the Tracked list`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (tracked) removeTracked(noradId);
        else addTracked(noradId);
      }}
      aria-pressed={tracked}
      aria-label={label}
      title={label}
      data-testid="track-button"
      className={`flex shrink-0 items-center gap-1 border px-1 py-0.5 text-[10px] hover:border-line-strong ${
        tracked ? 'border-accent/60 text-accent' : 'border-line text-muted hover:text-ink'
      }`}
    >
      <Star className="size-3" fill={tracked ? 'currentColor' : 'none'} aria-hidden />
      {tracked ? 'Tracked' : 'Track'}
    </button>
  );
}
