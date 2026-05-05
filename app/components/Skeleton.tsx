'use client';

import type { CSSProperties } from 'react';

type Shape = 'line' | 'circle' | 'rect';

interface SkeletonProps {
  /** Visual shape. "line" = rounded bar (default), "circle" = avatar, "rect" = card */
  shape?: Shape;
  /** CSS width — "100%", 120, "12rem". Default: "100%". */
  width?: string | number;
  /** CSS height — defaults: line=12px, circle=40, rect=80px. */
  height?: string | number;
  /** Extra Tailwind classes (margin, alignment, etc.). */
  className?: string;
}

const BASE = 'animate-pulse bg-gray-200';

/**
 * Single skeleton block. Compose multiple to build list rows, cards, etc.
 *
 *   <Skeleton width="60%" />
 *   <Skeleton shape="circle" width={40} height={40} />
 *   <Skeleton shape="rect" height={120} />
 */
export function Skeleton({
  shape = 'line',
  width,
  height,
  className = '',
}: SkeletonProps) {
  const style: CSSProperties = {
    width: width ?? '100%',
    height: height ?? (shape === 'line' ? 12 : shape === 'circle' ? 40 : 80),
  };

  const shapeClass =
    shape === 'circle'
      ? 'rounded-full'
      : shape === 'rect'
      ? 'rounded-lg'
      : 'rounded';

  return <div aria-hidden="true" className={`${BASE} ${shapeClass} ${className}`} style={style} />;
}

/**
 * SkeletonList — N rows of avatar + two stacked text bars.
 * Drop-in for "list of contacts/accounts/users still loading".
 */
export function SkeletonList({ rows = 5, showAvatar = true }: { rows?: number; showAvatar?: boolean }) {
  return (
    <ul aria-busy="true" aria-label="Loading…" className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3">
          {showAvatar && <Skeleton shape="circle" width={36} height={36} className="flex-shrink-0" />}
          <div className="flex-1 space-y-2">
            <Skeleton width="55%" height={10} />
            <Skeleton width="35%" height={8} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * SkeletonTable — header + N rows × M columns of equal-height bars.
 * For tabular pages (Accounts, Contacts, Sales) while data is loading.
 */
export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading…" className="w-full">
      {/* Header */}
      <div className="flex gap-4 border-b border-gray-100 pb-3 mb-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} width={i === 0 ? '20%' : '15%'} height={10} />
        ))}
      </div>
      {/* Rows */}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 items-center py-1">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} width={c === 0 ? '20%' : '15%'} height={12} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * SkeletonCard — title bar + couple of metric/text bars in a card frame.
 * For metric / KPI cards.
 */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading…"
      className={`bg-white rounded-xl border border-gray-100 shadow-sm p-5 ${className}`}
    >
      <Skeleton width="40%" height={10} className="mb-4" />
      <Skeleton width="65%" height={24} className="mb-2" />
      <Skeleton width="30%" height={10} />
    </div>
  );
}

export default Skeleton;
