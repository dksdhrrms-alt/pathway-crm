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
import { useEffect, useState } from 'react';

type Severity = 'info' | 'warning' | 'critical';

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  active: boolean;
  expires_at: string | null;
  created_at: string;
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
  if (!current) return null;

  const styles = SEVERITY_STYLES[current.severity] || SEVERITY_STYLES.info;

  function closeForThisLoad() {
    if (!current) return;
    setDismissedThisLoad((prev) => new Set(prev).add(current.id));
  }

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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className={`bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border ${styles.ring} overflow-hidden`}>
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <span className={`inline-block text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${styles.pill}`}>
                {styles.label}
              </span>
              <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">{current.title}</h2>
            </div>
            <button
              onClick={closeForThisLoad}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
            >
              ×
            </button>
          </div>
          {/* Body preserves line breaks the author typed. */}
          <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
            {current.body}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-slate-800/60 px-5 py-3 flex justify-end gap-2">
          <button
            onClick={dismissFiveDays}
            disabled={working}
            className="px-3 py-1.5 text-sm rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {working ? 'Saving…' : "Don't show for 5 days"}
          </button>
          <button
            onClick={closeForThisLoad}
            className="px-3 py-1.5 text-sm rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-medium"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
