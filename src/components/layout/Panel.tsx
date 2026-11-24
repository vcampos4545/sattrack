import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  icon?: LucideIcon;
  /** Right side of the title bar (status, toggles). */
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/** Bordered dashboard section with a compact uppercase title bar. */
export function Panel({ title, icon: Icon, actions, className = '', bodyClassName = '', children }: PanelProps) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col border border-line bg-panel ${className}`}>
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        {Icon && <Icon className="size-3.5 text-muted" aria-hidden />}
        <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

interface SlotEmptyStateProps {
  /** What this panel will show once built. */
  summary: string;
  /** Which build phase delivers it. */
  phase: string;
  children?: ReactNode;
}

/**
 * Honest placeholder for a panel whose feature is not implemented yet. It
 * says what is missing and never shows invented data.
 */
export function SlotEmptyState({ summary, phase, children }: SlotEmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <p className="text-muted">{summary}</p>
      <p className="font-mono text-[11px] uppercase tracking-wider text-faint">Not built yet · {phase}</p>
      {children}
    </div>
  );
}
