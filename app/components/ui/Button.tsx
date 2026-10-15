'use client';

/**
 * Button — the one primitive we never want hand-rolled again.
 *
 * Variants:
 *   primary    — Pathway green, white text. Main CTA.
 *   secondary  — Bordered neutral. Cancel, "Learn more".
 *   ghost      — Transparent, hover tint. Toolbar actions.
 *   destructive — Red. Delete, remove.
 *   outline    — Border + brand text. Alternative primary.
 *
 * Sizes: sm (h-8) / md (h-9, default) / lg (h-10) / icon (square).
 *
 * Why not shadcn/ui's Button directly? That one assumes `cva` + `clsx` +
 * `tailwind-merge`. Three dependencies for one component is overkill
 * when we already have 1-2 fixed Tailwind strings per variant.
 *
 * Press-nudge animation and focus-ring come from globals.css.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg ' +
  'press-nudge transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--ring)] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-brand-fg hover:bg-[var(--brand-hover)] active:bg-[var(--brand-active)]',
  secondary:
    'bg-surface text-foreground border border-border hover:bg-muted',
  ghost:
    'bg-transparent text-foreground hover:bg-muted',
  destructive:
    'bg-destructive text-destructive-fg hover:bg-destructive/90',
  outline:
    'bg-transparent text-brand border border-brand hover:bg-brand-tint',
};

const SIZES: Record<ButtonSize, string> = {
  sm:   'h-8 px-3 text-xs',
  md:   'h-9 px-4 text-sm',
  lg:   'h-10 px-5 text-sm',
  icon: 'h-9 w-9 p-0',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', loading, leftIcon, rightIcon, fullWidth,
    className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        BASE,
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner />}
      {!loading && leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
