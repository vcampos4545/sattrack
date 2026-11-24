import { Search } from 'lucide-react';

/**
 * Slot: satellite search by name or NORAD id, and add/remove from the
 * tracked list (store actions `select`, `trackNoradId`, `untrack`).
 * Owned by the globe/search task.
 */
export function SatelliteSearch() {
  return (
    <div className="flex max-w-sm items-center gap-2 text-[12px] text-faint">
      <Search className="size-3.5" aria-hidden />
      <span>Search by name or NORAD id: not built yet</span>
    </div>
  );
}
