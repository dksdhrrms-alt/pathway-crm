'use client';

/**
 * Card — the one container every "box" in the CRM renders inside.
 *
 * Variants:
 *   default   — Standard card (border + subtle shadow)
 *   elevated  — Modal-level shadow (shadow-lg)
 *   outline   — Border only, no shadow (dense table cells, side rails)
 *   ghost     — Transparent, border on hover only (list rows)
 *
 * `interactive` adds the card-hover micro-lift from globals.css.
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type CardVariant = 'default' | 'elevated' | 'outline' | 'ghost';

interface Props extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const VARIANTS: Record<CardVariant, string> = {
  default:  'bg-surface border border-border',
  elevated: 'bg-surface border border-border',
  outline:  'bg-transparent border border-border',
  ghost:    'bg-transparent border border-transparent hover:border-border',
};

const SHADOWS: Record<CardVariant, string> = {
  default:  'var(--shadow-sm)',
  elevated: 'var(--shadow-lg)',
  outline:  'none',
  ghost:    'none',
};

const PADDINGS = {
  none: '',
  sm:   'p-3',
  md:   'p-4',
  lg:   'p-5',
} as const;

export function Card({ variant = 'default', interactive, padding = 'md', className, children, style, ...rest }: Props) {
  return (
    <div
      className={cn(
        'rounded-xl',
        VARIANTS[variant],
        PADDINGS[padding],
        interactive && 'card-hover cursor-pointer',
        className,
      )}
      style={{ boxShadow: SHADOWS[variant], ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className }: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 mb-3', className)}>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-muted-fg mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
