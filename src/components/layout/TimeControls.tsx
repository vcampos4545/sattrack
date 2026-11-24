import { Clock } from 'lucide-react';
import { useSimTimeMs } from '../../hooks/use-sim-time';
import { useTimeStore } from '../../stores/time-store';
import { formatLocal, formatUtc } from '../../utils/format';

/**
 * Slot: global simulation-time bar. Shows the simulation clock that every
 * calculation uses. Owned by the time-controls task, which adds pause,
 * rate, step, jump-to-date and reset (all `useTimeStore` actions exist).
 */
export function TimeControls() {
  const now = useSimTimeMs(1);
  const rate = useTimeStore((s) => s.rate);
  const paused = useTimeStore((s) => s.paused);
  const live = useTimeStore((s) => s.isLive)();

  return (
    <div className="flex h-8 shrink-0 items-center gap-4 border-b border-line bg-base px-4 font-mono text-[12px] tabular">
      <Clock className="size-3.5 text-muted" aria-hidden />
      <span>{formatUtc(now)}</span>
      <span className="text-muted">{formatLocal(now)}</span>
      <span className={`ml-auto flex items-center gap-1.5 text-[11px] uppercase tracking-wider ${live ? 'text-ok' : 'text-warn'}`}>
        <span className={`inline-block size-1.5 rounded-full ${live ? 'bg-ok' : 'bg-warn'}`} />
        {live ? 'Live' : paused ? 'Paused' : `${rate}x`}
      </span>
    </div>
  );
}
