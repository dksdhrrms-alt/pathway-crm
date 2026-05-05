'use client';

import type { ReactNode } from 'react';

type Variant = 'default' | 'compact';

interface Props {
  /** Emoji or icon node shown above the title. Pass a string emoji for the
   *  cheerful style used on the dashboard ("🌟", "✅"), or a ReactNode for
   *  a custom SVG icon. */
  icon?: ReactNode;
  /** Headline. Should be short and human ("All caught up!", "No accounts yet"). */
  title: ReactNode;
  /** Optional one-line description / explanation. */
  description?: ReactNode;
  /** Optional CTA — either a fully-formed node (Link, button) or skip. */
  action?: ReactNode;
  /** "default" pads more, "compact" suits inline / sidebar / list cells. */
  variant?: Variant;
  className?: string;
}

const PAD_BY_VARIANT: Record<Variant, string> = {
  default: 'px-6 py-10',
  compact: 'px-4 py-6',
};

/**
 * Unified empty-state block. Use everywhere the answer to "I have no data
 * here" is currently a bare line of gray text or a one-off custom layout.
 *
 * Examples:
 *   <EmptyState icon="🌟" title="All clear!" description="Nothing urgent today." />
 *   <EmptyState icon="✅" title="All caught up!" description="No open tasks." variant="compact" />
 *   <EmptyState
 *     icon="📭"
 *     title="No accounts yet"
 *     description="Add your first account to get started."
 *     action={<Link href="/accounts" className="...">+ New Account</Link>}
 *   />
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
  className = '',
}: Props) {
  return (
    <div className={`text-center ${PAD_BY_VARIANT[variant]} ${className}`}>
      {icon && (
        <div
          aria-hidden="true"
          className={variant === 'compact' ? 'text-2xl mb-1' : 'text-4xl mb-2'}
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{title}</p>
      {description && (
        <p className={`text-xs text-gray-400 dark:text-gray-500 ${variant === 'compact' ? 'mt-0.5' : 'mt-1'}`}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
