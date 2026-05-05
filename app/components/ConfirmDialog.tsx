'use client';

import { useEffect, type ReactNode } from 'react';
import SubmitButton from './SubmitButton';

type Tone = 'danger' | 'warning' | 'info';

interface Props {
  /** Render the dialog. */
  open: boolean;
  /** Headline. Short and human, e.g. "Delete account?" */
  title: ReactNode;
  /** Body / explanation. Multi-line allowed. */
  description?: ReactNode;
  /** Label for the primary (confirm) button. Defaults vary by tone. */
  confirmLabel?: string;
  /** Label for the secondary (cancel) button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** "danger" = red confirm (delete, destroy). "warning" = amber. "info" = brand green. */
  tone?: Tone;
  /** Set true while the confirm action is running so we can show a spinner
   *  and disable both buttons. */
  pending?: boolean;
  /** Optional pendingText override on the confirm button. */
  pendingText?: string;
  /** Fired when the user clicks the primary confirm button. May be async — the
   *  parent should drive `pending`. */
  onConfirm: () => void | Promise<void>;
  /** Fired on cancel, backdrop click, or Escape. */
  onCancel: () => void;
}

const DEFAULT_CONFIRM_LABEL: Record<Tone, string> = {
  danger: 'Yes, delete',
  warning: 'Continue',
  info: 'Confirm',
};

const PENDING_LABEL_DEFAULT: Record<Tone, string> = {
  danger: 'Deleting...',
  warning: 'Working...',
  info: 'Saving...',
};

/**
 * Standard confirm modal used for destructive or otherwise meaningful actions
 * (delete, archive, sign-out, "are you sure?"). Replaces ad-hoc native
 * `window.confirm()` calls and one-off bespoke modals.
 *
 * Closes on Escape or backdrop click. Restores focus to the trigger after close
 * via the parent's own logic (we only handle dialog-internal focus).
 *
 * Usage:
 *   const [confirming, setConfirming] = useState(false);
 *   const [pending, setPending] = useState(false);
 *   <ConfirmDialog
 *     open={confirming}
 *     title="Delete this account?"
 *     description="This removes the account and unlinks all related contacts."
 *     tone="danger"
 *     pending={pending}
 *     onCancel={() => setConfirming(false)}
 *     onConfirm={async () => {
 *       setPending(true);
 *       try { await deleteAccount(id); setConfirming(false); }
 *       finally { setPending(false); }
 *     }}
 *   />
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  pending = false,
  pendingText,
  onConfirm,
  onCancel,
}: Props) {
  // Listen for Escape so the dialog can be dismissed without grabbing the
  // mouse. Focus is handled by `autoFocus` on the confirm button below.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pending, onCancel]);

  if (!open) return null;

  const finalConfirm = confirmLabel ?? DEFAULT_CONFIRM_LABEL[tone];
  const finalPendingText = pendingText ?? PENDING_LABEL_DEFAULT[tone];
  const submitVariant = tone === 'danger' ? 'danger' : 'primary';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-6">
        <h2 id="confirm-title" className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{description}</p>
        )}
        <div className="flex justify-end gap-2 mt-6">
          <SubmitButton
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel}
          </SubmitButton>
          <SubmitButton
            type="button"
            autoFocus
            variant={submitVariant}
            pending={pending}
            pendingText={finalPendingText}
            onClick={onConfirm}
          >
            {finalConfirm}
          </SubmitButton>
        </div>
      </div>
    </div>
  );
}
