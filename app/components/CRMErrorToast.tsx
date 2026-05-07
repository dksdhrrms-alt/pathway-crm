'use client';

import { useEffect, useState } from 'react';
import Toast from './Toast';

/**
 * Global listener for CRM CRUD failures.
 *
 * Why this file exists: every CRUD operation in lib/CRMContext.tsx is
 * fire-and-forget — the optimistic UI updates synchronously, the DB
 * write runs in the background. Until now those background writes
 * failed silently (the most damaging being addActivity, which didn't
 * even roll back the optimistic row, leading to disappearing-activity
 * reports from users on Mar 6+ — Jeff Harding's Ron Marriott log being
 * the case that surfaced this). After this change, each failure
 * dispatches a `crm-error` CustomEvent on `window`. This component
 * listens for those events and renders a single Toast at a time so the
 * user actually sees something went wrong instead of trusting the
 * vanished-on-refresh optimistic row.
 *
 * The window-event approach is deliberately decoupled — we don't want
 * CRMContext to import a toast hook or thread state through props for
 * what is essentially a side-channel notification.
 */
export interface CRMErrorEventDetail {
  message: string;
}

export default function CRMErrorToast() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    function handler(e: Event) {
      const ce = e as CustomEvent<CRMErrorEventDetail>;
      const msg = ce.detail?.message;
      if (typeof msg === 'string' && msg.trim()) {
        // Replace any current message — most recent wins. Users rarely
        // benefit from a queue of stacked errors.
        setMessage(msg);
      }
    }
    window.addEventListener('crm-error', handler);
    return () => window.removeEventListener('crm-error', handler);
  }, []);

  if (!message) return null;
  return (
    <Toast
      message={message}
      variant="error"
      onDone={() => setMessage(null)}
    />
  );
}
