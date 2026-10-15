'use client';

/**
 * Modal — compositional shell every dialog in the CRM should use.
 *
 * Previously 20+ modals each hand-rolled their own `fixed inset-0 ...`
 * wrapper, which is how we ended up with 4 different paddings, 3
 * different radii, and the mobile-safe-area bug that bit us earlier.
 *
 * Usage:
 *   <Modal onClose={close} size="lg">
 *     <Modal.Header title="New opportunity" subtitle="Add deal details" />
 *     <Modal.Body> …form fields… </Modal.Body>
 *     <Modal.Footer>
 *       <Button variant="secondary" onClick={close}>Cancel</Button>
 *       <Button onClick={save}>Save</Button>
 *     </Modal.Footer>
 *   </Modal>
 *
 * Baked in:
 *   · Backdrop click → onClose (unless `blockBackdropClose`)
 *   · ESC → onClose
 *   · `100dvh` cap + iPhone safe-area padding (the mobile fix from Oct)
 *   · Body scrolls when content is long, header + footer stay pinned
 *   · modalIn animation (globals.css)
 */

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

const SIZE_CLASS: Record<ModalSize, string> = {
  sm:  'max-w-sm',
  md:  'max-w-md',
  lg:  'max-w-lg',
  xl:  'max-w-xl',
  '2xl': 'max-w-2xl',
  full: 'max-w-5xl',
};

interface Props {
  onClose: () => void;
  size?: ModalSize;
  blockBackdropClose?: boolean;
  blockEscClose?: boolean;
  children: ReactNode;
  className?: string;
}

export function Modal({ onClose, size = 'lg', blockBackdropClose, blockEscClose, className, children }: Props) {
  useEffect(() => {
    if (blockEscClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, blockEscClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-3 animate-fadeIn"
      onClick={() => { if (!blockBackdropClose) onClose(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'bg-surface text-foreground rounded-xl border border-border w-full flex flex-col animate-modalIn',
          SIZE_CLASS[size],
          className,
        )}
        style={{
          maxHeight: 'calc(100dvh - 24px)',
          boxShadow: 'var(--shadow-xl)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Compositional sub-components ─────────────────────────────

function Header({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose?: () => void }) {
  return (
    <div className="shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-muted-fg mt-0.5">{subtitle}</p>}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 -mr-1 -mt-1 w-9 h-9 rounded-full flex items-center justify-center text-muted-fg hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

function Body({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('flex-1 min-h-0 overflow-y-auto px-5 py-4', className)}
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {children}
    </div>
  );
}

function Footer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-[color-mix(in_oklab,var(--surface-muted),transparent_50%)]', className)}
    >
      {children}
    </div>
  );
}

Modal.Header = Header;
Modal.Body = Body;
Modal.Footer = Footer;
