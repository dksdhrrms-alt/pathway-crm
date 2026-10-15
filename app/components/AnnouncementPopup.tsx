'use client';

/**
 * AnnouncementPopup — Home-page modal that surfaces any active admin
 * announcement that the current user has NOT dismissed within the last
 * 5 days.
 *
 * Behavior:
 *   - Mounted in app/dashboard/page.tsx so it fires every time the user
 *     lands on Home, even when their session is still alive (a fresh tab
 *     after sleeping the laptop still triggers it).
 *   - Fetches /api/announcements (server filters by active + expiry +
 *     per-user dismissal window), then shows the most-recent item.
 *   - Two buttons:
 *       "Got it"           — closes the popup for this page-load only.
 *                            Next Home entry, the popup comes back.
 *       "Dismiss 5 days"   — POSTs /api/announcements/<id>/dismiss,
 *                            which writes server-side. Cross-device per
 *                            spec (PC + mobile share the dismissal).
 *
 * Severity drives the accent color so warnings/criticals don't get
 * tuned out the way an info banner might.
 */
import { useCallback, useEffect, useState } from 'react';

type Severity = 'info' | 'warning' | 'critical';

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  /** Server-attached author info — name + role label so the popup can
   *  show "Posted by <name> · <role>" instead of an opaque uuid. Null
   *  if the original author was deleted from the users table. */
  author?: { id: string; name: string; role: string; role_label: string } | null;
}

const SEVERITY_STYLES: Record<Severity, { ring: string; pill: string; label: string }> = {
  info:     { ring: 'border-blue-200 dark:border-blue-800',     pill: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',     label: 'Notice' },
  warning:  { ring: 'border-amber-200 dark:border-amber-800',   pill: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', label: 'Heads up' },
  critical: { ring: 'border-red-300 dark:border-red-700',       pill: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',         label: 'Action needed' },
};

export default function AnnouncementPopup() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissedThisLoad, setDismissedThisLoad] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/announcements', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json() as { items?: Announcement[] };
        if (!cancelled && Array.isArray(j.items)) setItems(j.items);
      } catch {
        // Silent — popup is best-effort; never block the Home page.
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const current = items.find((a) => !dismissedThisLoad.has(a.id));

  const closeForThisLoad = useCallback(() => {
    if (!current) return;
    setDismissedThisLoad((prev) => new Set(prev).add(current.id));
  }, [current]);

  async function dismissFiveDays() {
    if (!current || working) return;
    setWorking(true);
    try {
      await fetch(`/api/announcements/${current.id}/dismiss`, { method: 'POST' });
    } catch {
      // Even if the POST fails, hide it this load — re-prompt next visit.
    } finally {
      setWorking(false);
      closeForThisLoad();
    }
  }

  // ESC closes — important on small screens where the "×" and footer
  // buttons could still be hidden by soft keyboards or address bars.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeForThisLoad(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, closeForThisLoad]);

  if (!current) return null;

  const styles = SEVERITY_STYLES[current.severity] || SEVERITY_STYLES.info;

  return (
    // Backdrop — clicking outside the dialog also closes. On a phone
    // whose software keyboard somehow pushes the dialog off-screen,
    // the user can still tap any visible dark area to escape.
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 sm:p-4"
      onClick={closeForThisLoad}
    >
      {/*
        Three-row flex layout so the footer buttons are ALWAYS visible
        regardless of body length:
          - header  (shrink-0)
          - body    (flex-1, overflow-y-auto → scrolls when text is long)
          - footer  (shrink-0, sticky at bottom)
        max-h ties the whole dialog to the viewport height minus a bit
        of breathing room; on small phones (~600px tall) this means
        the body gets scrolled instead of pushing the buttons off-screen.
        pb-[env(safe-area-inset-bottom)] keeps the "Got it" button clear
        of the iPhone home indicator when installed as a PWA.
      */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border ${styles.ring} flex flex-col overflow-hidden`}
        style={{ maxHeight: 'calc(100dvh - 1rem)' }}
      >
        {/* Header — shrink-0 so it never gets scrolled */}
        <div className="shrink-0 px-5 pt-5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <span className={`inline-block text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${styles.pill}`}>
                {styles.label}
              </span>
              <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">{current.title}</h2>
              {current.author && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Posted by <span className="font-medium text-gray-700 dark:text-gray-300">{current.author.name}</span>
                  {current.author.role_label && (
                    <> · <span className="text-gray-500 dark:text-gray-400">{current.author.role_label}</span></>
                  )}
                </p>
              )}
            </div>
            {/* Bigger tap target — 40×40 on phones is comfortable; the old
                tiny × on a long title row was borderline unreachable one-handed */}
            <button
              onClick={closeForThisLoad}
              aria-label="Close"
              className="shrink-0 w-10 h-10 -mr-2 -mt-2 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 text-2xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body — the ONLY element that scrolls when content is long */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4">
          <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
            {current.body}
          </p>
        </div>

        {/* Footer — always visible, sticks to bottom, honors safe-area */}
        <div
          className="shrink-0 bg-gray-50 dark:bg-slate-800/60 border-t border-gray-200 dark:border-slate-700 px-4 py-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          {/* Full-width buttons on phones (<sm), inline on tablet+ */}
          <button
            onClick={dismissFiveDays}
            disabled={working}
            className="w-full sm:w-auto px-4 py-2.5 sm:py-1.5 text-sm rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {working ? 'Saving…' : "Don't show for 5 days"}
          </button>
          <button
            onClick={closeForThisLoad}
            className="w-full sm:w-auto px-4 py-2.5 sm:py-1.5 text-sm rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-medium"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
