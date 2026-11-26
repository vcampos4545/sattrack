import { useMemo } from 'react';
import { useSatelliteStore } from '../../stores/satellite-store';
import { CATEGORY_LABELS, CATEGORY_PRIORITY, type SatelliteCategory } from '../../types/satellite';
import { CATEGORY_COLORS } from '../../utils/category-colors';

/**
 * Category legend and filter. Each chip shows the category color and how
 * many catalog objects it has; clicking toggles whether that category is
 * drawn and propagated (`setCategoryVisible`). Categories with no catalog
 * objects are left out.
 */
export function SatelliteFilters() {
  const active = useSatelliteStore((s) => s.active);
  const filter = useSatelliteStore((s) => s.categoryFilter);
  const setCategoryVisible = useSatelliteStore((s) => s.setCategoryVisible);

  const counts = useMemo(() => {
    const m = new Map<SatelliteCategory, number>();
    for (const r of active) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [active]);

  const present = CATEGORY_PRIORITY.filter((c) => counts.has(c));
  if (present.length === 0) return null;
  const anyHidden = present.some((c) => !filter[c]);

  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-[11px]" role="group" aria-label="Category filters">
      {present.map((c) => {
        const on = filter[c];
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => setCategoryVisible(c, !on)}
            title={`${on ? 'Hide' : 'Show'} ${CATEGORY_LABELS[c]}`}
            className={`flex items-center gap-1.5 border bg-panel/80 px-1.5 py-0.5 backdrop-blur hover:border-line-strong ${on ? 'border-line text-ink' : 'border-line/60 text-faint line-through'}`}
          >
            <span
              className="inline-block size-2 border"
              style={{ background: on ? CATEGORY_COLORS[c] : 'transparent', borderColor: CATEGORY_COLORS[c] }}
            />
            {CATEGORY_LABELS[c]}
            <span className="text-muted tabular">{counts.get(c)}</span>
          </button>
        );
      })}
      {anyHidden && (
        <button
          type="button"
          onClick={() => present.forEach((c) => setCategoryVisible(c, true))}
          className="px-1.5 py-0.5 text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Show all
        </button>
      )}
    </div>
  );
}
