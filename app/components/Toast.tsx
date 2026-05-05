'use client';

import { useEffect } from 'react';

export type ToastVariant = 'success' | 'warning' | 'error' | 'info';

interface ToastProps {
  message: string;
  /** Visual + semantic tone. Defaults to 'success' to preserve existing call sites. */
  variant?: ToastVariant;
  /** Override the auto-dismiss timing. Errors default to longer so the user
   *  has a chance to read them. */
  durationMs?: number;
  onDone: () => void;
}

const ICON_BG_BY_VARIANT: Record<ToastVariant, string> = {
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
};

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3000,
  info: 3000,
  warning: 4500,
  error: 6000,
};

const ROLE_BY_VARIANT: Record<ToastVariant, 'status' | 'alert'> = {
  success: 'status',
  info: 'status',
  warning: 'alert',
  error: 'alert',
};

function VariantIcon({ variant }: { variant: ToastVariant }) {
  // All icons share the same 24-viewbox + currentColor stroke approach.
  switch (variant) {
    case 'success':
      return (
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'warning':
      return (
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 9v3m0 3h.01" />
        </svg>
      );
    case 'error':
      return (
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 6l12 12M6 18L18 6" />
        </svg>
      );
    case 'info':
      return (
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 9v6m0-9h.01" />
        </svg>
      );
  }
}

export default function Toast({ message, variant = 'success', durationMs, onDone }: ToastProps) {
  useEffect(() => {
    const ms = durationMs ?? DEFAULT_DURATION[variant];
    const timer = setTimeout(onDone, ms);
    return () => clearTimeout(timer);
  }, [onDone, variant, durationMs]);

  return (
    <div
      role={ROLE_BY_VARIANT[variant]}
      aria-live={variant === 'error' || variant === 'warning' ? 'assertive' : 'polite'}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-gray-900 text-white px-4 py-3 rounded-xl shadow-xl text-sm font-medium max-w-sm"
    >
      <div
        aria-hidden="true"
        className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${ICON_BG_BY_VARIANT[variant]}`}
      >
        <VariantIcon variant={variant} />
      </div>
      <span className="leading-tight">{message}</span>
    </div>
  );
}
