import { useEffect, useState } from 'react';
import { useTimeStore } from '../stores/time-store';

/**
 * Current simulation time (UTC ms), re-rendering at `hz` and immediately when
 * the clock is controlled (pause, jump, rate change). Use a low rate (1 Hz)
 * for text panels; 3D views should read `getSimTimeMs()` inside their frame
 * loop instead of re-rendering React.
 */
export function useSimTimeMs(hz = 1): number {
  const [now, setNow] = useState(() => useTimeStore.getState().now());
  // Any clock control changes the anchors, so subscribing to them is enough.
  const anchor = useTimeStore((s) => `${s.anchorRealMs}:${s.anchorSimMs}:${s.rate}:${s.paused}`);
  useEffect(() => {
    setNow(useTimeStore.getState().now());
    const id = setInterval(() => setNow(useTimeStore.getState().now()), 1000 / Math.max(0.1, hz));
    return () => clearInterval(id);
  }, [hz, anchor]);
  return now;
}
