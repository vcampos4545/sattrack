import { CalendarClock, ChevronLeft, ChevronRight, Clock, Keyboard, Pause, Play, Radio, Repeat } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatDateTimeInput, parseDateTimeInput, type DateTimeZone } from '../../core/orbit/time-utils';
import { useSimTimeMs } from '../../hooks/use-sim-time';
import { getWallClockMs, MAX_ABS_RATE, useTimeStore } from '../../stores/time-store';
import { formatClockOffset, formatLocal, formatUtc } from '../../utils/format';

/** Speed magnitudes offered (simulation seconds per real second). Direction is a separate toggle. */
const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 10_000, MAX_ABS_RATE];

/** Step sizes for the step buttons and arrow keys. */
const STEPS: { label: string; ms: number }[] = [
  { label: '10 s', ms: 10_000 },
  { label: '1 min', ms: 60_000 },
  { label: '10 min', ms: 600_000 },
  { label: '1 h', ms: 3_600_000 },
  { label: '6 h', ms: 21_600_000 },
  { label: '1 d', ms: 86_400_000 },
];

const SHORTCUTS: [string, string][] = [
  ['Space', 'Pause / resume'],
  ['← →', 'Step back / forward'],
  ['[ ]', 'Slower / faster'],
  ['R', 'Reverse direction'],
  ['J', 'Jump to date/time'],
  ['L', 'Reset to live'],
];

function formatRate(rate: number): string {
  const abs = Math.abs(rate);
  const text = abs >= 10_000 && abs % 1000 === 0 ? `${abs / 1000}k` : String(abs);
  return `${rate < 0 ? '-' : ''}${text}x`;
}

/** Real time, re-rendered at 1 Hz. Kept separate because `useSimTimeMs` does not tick while paused. */
function useWallClockMs(): number {
  const [now, setNow] = useState(getWallClockMs);
  useEffect(() => {
    const id = setInterval(() => setNow(getWallClockMs()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Keys typed into form fields must not drive the clock. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

/**
 * Global simulation-time bar. Every orbital calculation reads the clock in
 * `useTimeStore`; this component only drives its actions (pause, resume,
 * setRate, step, jumpTo, resetToLive) and shows where simulation time is
 * relative to real time. Times are entered and shown in local time or UTC;
 * the store always holds UTC ms.
 */
export function TimeControls() {
  const rate = useTimeStore((s) => s.rate);
  const paused = useTimeStore((s) => s.paused);
  const { pause, resume, setRate, step, resetToLive } = useTimeStore.getState();
  // Re-render more often when time runs fast so the clock reads smoothly.
  const simMs = useSimTimeMs(paused || Math.abs(rate) <= 1 ? 1 : 4);
  const realMs = useWallClockMs();
  const live = useTimeStore((s) => s.isLive)();
  const offsetMs = simMs - realMs;

  const [stepMs, setStepMs] = useState(60_000);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const speed = Math.abs(rate);
  const reverse = rate < 0;
  const speeds = SPEEDS.includes(speed) ? SPEEDS : [...SPEEDS, speed].sort((a, b) => a - b);

  // Keyboard shortcuts. Read store state at key time so the handler never goes stale.
  const stepRef = useRef(stepMs);
  stepRef.current = stepMs;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const t = useTimeStore.getState();
      const shiftSpeed = (dir: 1 | -1) => {
        const mag = Math.abs(t.rate);
        const next = dir > 0 ? SPEEDS.find((s) => s > mag) : [...SPEEDS].reverse().find((s) => s < mag);
        if (next !== undefined) t.setRate(Math.sign(t.rate || 1) * next);
      };
      switch (e.key) {
        case ' ':
          if (t.paused) t.resume();
          else t.pause();
          break;
        case 'ArrowLeft':
          t.step(-stepRef.current);
          break;
        case 'ArrowRight':
          t.step(stepRef.current);
          break;
        case '[':
          shiftSpeed(-1);
          break;
        case ']':
          shiftSpeed(1);
          break;
        case 'r':
        case 'R':
          t.setRate(-t.rate);
          break;
        case 'l':
        case 'L':
          t.resetToLive();
          break;
        case 'j':
        case 'J':
          setJumpOpen(true);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const state = live ? 'live' : paused ? 'paused' : 'sim';
  const stateClass = { live: 'text-ok', paused: 'text-warn', sim: 'text-accent' }[state];
  const dotClass = { live: 'bg-ok', paused: 'bg-warn', sim: 'bg-accent' }[state];
  const btn =
    'flex h-6 items-center gap-1 border border-line px-1.5 text-muted hover:border-line-strong hover:text-ink disabled:pointer-events-none disabled:opacity-40';
  const select = 'h-6 border border-line bg-panel px-1 font-mono text-[11px] text-ink hover:border-line-strong';

  return (
    <div className="relative z-10 flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-base px-4 py-1 font-mono text-[12px] tabular">
      {/* Status and simulation time */}
      <span
        className={`flex w-[74px] items-center gap-1.5 text-[11px] uppercase tracking-wider ${stateClass}`}
        aria-live="polite"
        title={live ? 'Tracking real time' : paused ? 'Simulation clock paused' : 'Simulation clock running off real time'}
      >
        <span className={`inline-block size-1.5 rounded-full ${dotClass} ${state === 'sim' ? 'animate-pulse' : ''}`} />
        {live ? 'Live' : paused ? 'Paused' : formatRate(rate)}
      </span>
      <span className="flex items-center gap-2" title="Simulation time (used by every calculation)">
        <Clock className="size-3.5 text-muted" aria-hidden />
        <span className="text-[10px] uppercase tracking-wider text-faint">Sim</span>
        <span className="text-ink">{formatUtc(simMs)}</span>
        <span className="text-muted">{formatLocal(simMs)}</span>
      </span>
      <span
        className={`flex items-center gap-2 ${live ? 'text-faint' : 'text-muted'}`}
        title={`Real time ${formatUtc(realMs)}. Δ is simulation time minus real time.`}
      >
        <span className="text-[10px] uppercase tracking-wider text-faint">Real</span>
        {/* Real UTC only on wide screens; the offset always shows and the title carries the full value. */}
        <span className="hidden 2xl:inline">{formatUtc(realMs)}</span>
        <span className={live ? 'text-faint' : offsetMs < 0 ? 'text-warn' : 'text-accent'}>
          {live ? 'Δ ±00:00:00' : `Δ ${formatClockOffset(offsetMs)}`}
        </span>
      </span>

      {/* Controls */}
      <div className="ml-auto flex items-center gap-1.5">
        <select
          className={select}
          value={stepMs}
          onChange={(e) => setStepMs(Number(e.target.value))}
          aria-label="Step size"
          title="Step size"
        >
          {STEPS.map((s) => (
            <option key={s.ms} value={s.ms}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" className={btn} onClick={() => step(-stepMs)} aria-label="Step back" title="Step back (←)">
          <ChevronLeft className="size-3.5" />
        </button>
        <button
          type="button"
          className={`${btn} ${paused ? 'text-warn' : ''}`}
          onClick={() => (paused ? resume() : pause())}
          aria-label={paused ? 'Resume' : 'Pause'}
          title={paused ? 'Resume (Space)' : 'Pause (Space)'}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </button>
        <button type="button" className={btn} onClick={() => step(stepMs)} aria-label="Step forward" title="Step forward (→)">
          <ChevronRight className="size-3.5" />
        </button>

        <span className="mx-1 h-4 w-px bg-line" aria-hidden />

        <button
          type="button"
          className={`${btn} ${reverse ? 'border-warn/60 text-warn' : ''}`}
          onClick={() => setRate(-rate)}
          aria-pressed={reverse}
          title="Run time backward (R)"
        >
          <Repeat className="size-3.5" />
          <span className="text-[11px]">Rev</span>
        </button>
        <select
          className={select}
          value={speed}
          onChange={(e) => setRate((reverse ? -1 : 1) * Number(e.target.value))}
          aria-label="Simulation speed"
          title="Simulation speed ([ and ])"
        >
          {speeds.map((s) => (
            <option key={s} value={s}>
              {formatRate((reverse ? -1 : 1) * s)}
            </option>
          ))}
        </select>

        <span className="mx-1 h-4 w-px bg-line" aria-hidden />

        <div className="relative">
          <button
            type="button"
            className={`${btn} ${jumpOpen ? 'border-line-strong text-ink' : ''}`}
            onClick={() => setJumpOpen((o) => !o)}
            aria-expanded={jumpOpen}
            title="Jump to date/time (J)"
          >
            <CalendarClock className="size-3.5" />
            <span className="text-[11px]">Jump</span>
          </button>
          {jumpOpen && <JumpPanel simMs={simMs} onClose={() => setJumpOpen(false)} />}
        </div>
        <button
          type="button"
          className={`${btn} ${live ? '' : 'border-ok/50 text-ok'}`}
          onClick={resetToLive}
          disabled={live}
          title="Reset to real time (L)"
        >
          <Radio className="size-3.5" />
          <span className="text-[11px]">Live</span>
        </button>
        <div className="relative">
          <button
            type="button"
            className={btn}
            onClick={() => setHelpOpen((o) => !o)}
            aria-expanded={helpOpen}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
          >
            <Keyboard className="size-3.5" />
          </button>
          {helpOpen && (
            <div className="absolute top-full right-0 mt-1 w-56 border border-line-strong bg-panel-raised p-2 font-sans shadow-2xl shadow-black/50">
              <table className="w-full text-[11px]">
                <tbody>
                  {SHORTCUTS.map(([k, d]) => (
                    <tr key={k}>
                      <td className="py-0.5 pr-3 font-mono text-ink">{k}</td>
                      <td className="py-0.5 text-muted">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Jump-to-instant form. The text is edited in the chosen zone (local by
 * default) and converted to UTC ms before it reaches the store. Switching
 * zones re-expresses the same instant instead of reinterpreting the digits.
 */
function JumpPanel({ simMs, onClose }: { simMs: number; onClose: () => void }) {
  const [zone, setZone] = useState<DateTimeZone>('local');
  const [text, setText] = useState(() => formatDateTimeInput(simMs, 'local'));
  const parsed = parseDateTimeInput(text, zone);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const switchZone = (next: DateTimeZone) => {
    if (next === zone) return;
    if (parsed !== null) setText(formatDateTimeInput(parsed, next));
    setZone(next);
  };
  const submit = () => {
    if (parsed === null) return;
    useTimeStore.getState().jumpTo(parsed);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1 w-[300px] border border-line-strong bg-panel-raised p-3 font-sans shadow-2xl shadow-black/50"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter') submit();
      }}
    >
      <div className="mb-2 flex items-center">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Jump to</h3>
        <div className="ml-auto flex border border-line text-[11px]" role="radiogroup" aria-label="Time zone">
          {(['local', 'utc'] as const).map((z) => (
            <button
              key={z}
              type="button"
              role="radio"
              aria-checked={zone === z}
              onClick={() => switchZone(z)}
              className={`px-2 py-0.5 ${zone === z ? 'bg-line-strong text-ink' : 'text-muted hover:text-ink'}`}
            >
              {z === 'local' ? 'Local' : 'UTC'}
            </button>
          ))}
        </div>
      </div>
      <input
        type="datetime-local"
        step={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        aria-label={`Date and time (${zone === 'local' ? 'local' : 'UTC'})`}
        aria-invalid={parsed === null}
        className="w-full border border-line bg-panel px-2 py-1 font-mono text-[12px] text-ink [color-scheme:dark] focus:border-accent focus:outline-none"
      />
      <p className={`mt-1.5 h-4 font-mono text-[11px] tabular ${parsed === null ? 'text-danger' : 'text-faint'}`}>
        {parsed === null ? 'Enter a valid date and time' : zone === 'local' ? formatUtc(parsed) : formatLocal(parsed)}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => setText(formatDateTimeInput(getWallClockMs(), zone))}
          className="border border-line px-2 py-1 text-[11px] text-muted hover:border-line-strong hover:text-ink"
        >
          Fill real now
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={parsed === null}
          className="ml-auto border border-accent/60 px-3 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          Go
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        Keeps the current paused or running state. SGP4 accuracy drops as time moves away from each element set's
        epoch.
      </p>
    </div>
  );
}
