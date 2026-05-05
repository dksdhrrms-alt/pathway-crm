'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Button label (or any node). Replaced by `pendingText` while pending. */
  children: ReactNode;
  /** When true, the button is disabled and shows the loading state. */
  pending?: boolean;
  /** Optional alternate label shown while pending. Defaults to "Saving...". */
  pendingText?: ReactNode;
  /** Visual style variant. */
  variant?: Variant;
  /** Optional override of the default size classes. */
  className?: string;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed',
  secondary:
    'text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-60 disabled:cursor-not-allowed',
  danger:
    'text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed',
};

const PRIMARY_BG = '#1a4731';
const BASE_CLASSES =
  'inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg transition-opacity';

/**
 * SubmitButton
 *
 * Drop-in replacement for the existing primary action buttons (Create / Save /
 * Import / etc.). Centralizes:
 *   - disabled + cursor styling while a submission is in flight
 *   - a small spinner + alternate label so the user has clear feedback
 *   - the brand color (#1a4731) so individual call sites no longer need
 *     inline `style={{ backgroundColor: ... }}`.
 *
 * The parent owns the `pending` state. Pair with the typical pattern:
 *
 *   const [submitting, setSubmitting] = useState(false);
 *   async function handleSubmit() {
 *     if (submitting) return;
 *     setSubmitting(true);
 *     try { await doStuff(); } finally { setSubmitting(false); }
 *   }
 *   <SubmitButton pending={submitting} onClick={handleSubmit}>Save</SubmitButton>
 */
export default function SubmitButton({
  children,
  pending = false,
  pendingText = 'Saving...',
  variant = 'primary',
  disabled,
  className = '',
  type = 'button',
  style,
  ...rest
}: Props) {
  const isDisabled = disabled || pending;

  const finalStyle =
    variant === 'primary'
      ? { backgroundColor: PRIMARY_BG, ...style }
      : style;

  return (
    <button
      {...rest}
      type={type}
      disabled={isDisabled}
      aria-busy={pending || undefined}
      style={finalStyle}
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {pending && (
        <span
          aria-hidden="true"
          className="inline-block w-3.5 h-3.5 mr-2 border-2 border-current border-t-transparent rounded-full animate-spin align-middle"
        />
      )}
      {pending ? pendingText : children}
    </button>
  );
}
