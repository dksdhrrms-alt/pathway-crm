'use client';

/**
 * Skeleton — the shimmering gray placeholder that replaces every
 * `<p>Loading…</p>` in the app.
 *
 * Why bother? Raw "Loading…" text is three UX misses in one:
 *   1. The layout jumps when the real content arrives.
 *   2. The user doesn't know whether 50 or 500 rows are coming.
 *   3. On dark mode it looks "frozen".
 *
 * The shimmer keyframe + background-image is in globals.css under
 * `.skeleton`. These helpers just wrap it in common shapes.
 */

import { cn } from './cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

/** Repeated single-line rows — most common case (list, table rows). */
export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Card placeholder — title row + 2 body lines. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface p-5 space-y-3', className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

/** Table placeholder — header row + N body rows. */
export function SkeletonTable({ rows = 5, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface overflow-hidden', className)}>
      <div className="grid gap-3 p-3 bg-[var(--surface-muted)]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, i) => <Skeleton key={i} className="h-4" />)}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid gap-3 p-3 border-t border-border" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, j) => <Skeleton key={j} className="h-4" />)}
        </div>
      ))}
    </div>
  );
}

/** Big number stat — e.g. Dashboard KPI card. */
export function SkeletonStat({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface p-5 space-y-3', className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}
