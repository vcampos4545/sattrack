import { TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Shown in the fallback and the console, e.g. "Sky plot". */
  name: string;
  /** Optional custom fallback; receives the error and a retry callback. */
  fallback?: (error: Error, retry: () => void) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Contains a render error to one panel so the rest of the dashboard keeps
 * working. The fallback names the panel, shows the message and offers a
 * retry (re-mount). Errors are logged with the component stack.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ui] ${this.props.name} failed to render`, error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);
    return <PanelError name={this.props.name} message={error.message} onRetry={this.retry} />;
  }
}

export function PanelError({ name, message, onRetry }: { name: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex h-full min-h-24 flex-col items-center justify-center gap-2 border border-line bg-panel px-6 py-6 text-center">
      <div className="flex items-center gap-2 text-danger">
        <TriangleAlert className="size-4" aria-hidden />
        <span className="text-[11px] font-medium uppercase tracking-[0.12em]">{name} unavailable</span>
      </div>
      <p className="max-w-md font-mono text-[11px] break-words text-muted">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="border border-line-strong px-2 py-0.5 font-mono text-[11px] hover:border-accent">
          Retry
        </button>
      )}
    </div>
  );
}
