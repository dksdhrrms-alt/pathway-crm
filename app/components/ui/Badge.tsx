'use client';

/**
 * Badge — compact status / category pill.
 *
 * Variants map to semantic tokens so a "success" badge is the same
 * color everywhere. For arbitrary role colors (Org Map Champion /
 * Decision Maker / Blocker etc.), pass a `tone` prop.
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone =
  | 'neutral' | 'brand' | 'success' | 'warning' | 'destructive' | 'info'
  | 'amber' | 'rose' | 'violet' | 'sky';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: 'xs' | 'sm' | 'md';
  dot?: boolean;
  children: ReactNode;
}

const TONES: Record<BadgeTone, string> = {
  neutral:     'bg-muted text-muted-fg border border-border',
  brand:       'bg-brand-tint text-brand border border-brand/20',
  success:     'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800',
  warning:     'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
  destructive: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800',
  info:        'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800',
  amber:       'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
  rose:        'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800',
  violet:      'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800',
  sky:         'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800',
};

const SIZES = {
  xs: 'text-[10px] px-1.5 py-0.5',
  sm: 'text-[11px] px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
} as const;

export function Badge({ tone = 'neutral', size = 'sm', dot, className, children, ...rest }: Props) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full font-medium', TONES[tone], SIZES[size], className)}
      {...rest}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}
