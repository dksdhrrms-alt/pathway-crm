'use client';

/**
 * Input / Textarea / Select / Field — one visual language for forms.
 *
 * Three value-adds vs raw <input>:
 *   1. Consistent spacing, border, focus ring (ring = brand color token)
 *   2. iOS zoom-safe font-size via globals.css at 16px
 *   3. `error` prop auto-renders a message + red border
 *
 * Field (optional) wraps Input with a label + hint + error block so form
 * markup stays flat.
 */

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

const BASE_FIELD =
  'w-full rounded-lg border bg-surface text-foreground placeholder:text-muted-fg ' +
  'focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const FIELD_SIZES = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
  lg: 'h-10 px-3.5 text-sm',
} as const;

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', error, className, ...rest }, ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        BASE_FIELD,
        FIELD_SIZES[size],
        error
          ? 'border-destructive focus:ring-destructive/30'
          : 'border-input focus:border-brand focus:ring-[var(--brand-ring)]',
        className,
      )}
      {...rest}
    />
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { error, className, ...rest }, ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        BASE_FIELD,
        'px-3 py-2 text-sm leading-relaxed resize-y',
        error
          ? 'border-destructive focus:ring-destructive/30'
          : 'border-input focus:border-brand focus:ring-[var(--brand-ring)]',
        className,
      )}
      {...rest}
    />
  );
});

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', error, className, children, ...rest }, ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        BASE_FIELD,
        FIELD_SIZES[size],
        'pr-8 appearance-none bg-no-repeat bg-[length:16px] bg-[position:right_8px_center]',
        error
          ? 'border-destructive focus:ring-destructive/30'
          : 'border-input focus:border-brand focus:ring-[var(--brand-ring)]',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
});

// ── Field wrapper (optional convenience) ─────────────────────

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  return (
    <label className={cn('block', className)}>
      {label && (
        <span className="block text-[11px] font-semibold text-muted-fg uppercase tracking-wide mb-1">
          {label}{required && <span className="text-destructive"> *</span>}
        </span>
      )}
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {!error && hint && <p className="mt-1 text-[11px] text-muted-fg">{hint}</p>}
    </label>
  );
}
