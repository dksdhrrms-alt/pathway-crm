'use client';

import { useEffect } from 'react';

/**
 * useEscClose — wires the Escape key to the modal's onClose handler.
 *
 * Sales reps were losing in-progress edits because clicking the dim
 * backdrop closed the modal mid-drag. We removed the backdrop-click
 * dismiss across all modals; Esc / Cancel / the × button are now the
 * only ways out. Most modals already had an inline `useEffect`
 * listening for Escape, but ~12 of them did not — this hook gives
 * them a one-liner replacement so the keyboard behavior stays
 * consistent without duplicating useEffect plumbing everywhere.
 *
 * Usage:
 *   useEscClose(onClose);  // top of the component
 */
export function useEscClose(onClose: () => void): void {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);
}
