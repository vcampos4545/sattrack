import { MonitorX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

let webglSupport: boolean | null = null;

/**
 * Whether this browser can create a WebGL context at all. Checked once with a
 * throwaway canvas; disabled hardware acceleration, blocklisted GPUs and some
 * headless setups return null here.
 */
export function isWebGLAvailable(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    webglSupport = gl !== null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

function WebGLMessage({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <MonitorX className="size-5 text-warn" aria-hidden />
      <p className="text-ink">{title}</p>
      <p className="max-w-sm text-[12px] text-muted">{detail}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="border border-line-strong px-2 py-0.5 font-mono text-[11px] hover:border-accent">
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Wraps a react-three-fiber `<Canvas>`. Shows a clear message instead of a
 * blank or crashed panel when WebGL is unavailable, when creating the
 * renderer throws, or when the GPU drops the context. Data panels (passes,
 * sky plot, selected object) do not need WebGL and keep working.
 *
 * `onContextLost` should be wired to the canvas (see `contextLossHandlers`).
 */
export function WebGLGuard({ view, children }: { view: string; children: (handlers: ContextLossHandlers) => ReactNode }) {
  const [lost, setLost] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (!isWebGLAvailable()) {
    return (
      <WebGLMessage
        title={`${view} needs WebGL`}
        detail="This browser could not create a WebGL context (hardware acceleration off, unsupported GPU, or a headless browser). Passes, the sky plot and the selected-object data still work."
      />
    );
  }
  if (lost) {
    return (
      <WebGLMessage
        title="The graphics context was lost"
        detail="The GPU reset or the browser reclaimed the context. Retry to recreate the view."
        onRetry={() => {
          setLost(false);
          setAttempt((a) => a + 1);
        }}
      />
    );
  }
  return (
    <ErrorBoundary
      key={attempt}
      name={view}
      fallback={(error, retry) => (
        <WebGLMessage title={`${view} could not start`} detail={error.message} onRetry={retry} />
      )}
    >
      {children({ onCreated: ({ gl }) => watchContextLoss(gl.domElement, () => setLost(true)) })}
    </ErrorBoundary>
  );
}

export interface ContextLossHandlers {
  /** Pass to `<Canvas onCreated>`. */
  onCreated: (state: { gl: { domElement: HTMLCanvasElement } }) => void;
}

function watchContextLoss(canvas: HTMLCanvasElement, onLost: () => void): void {
  canvas.addEventListener(
    'webglcontextlost',
    (e) => {
      // preventDefault would allow a restore, but R3F does not rebuild its
      // GPU resources, so a clean re-mount is the reliable recovery.
      e.preventDefault();
      console.warn('[webgl] context lost');
      onLost();
    },
    { once: true },
  );
}
