/**
 * /refresh — emergency PWA reset page.
 *
 * Why this exists: iOS Safari and some Android Chrome PWAs hold on to old
 * service workers and cached chunks tenaciously, so even after we ship a
 * new SW with the right skipWaiting + clients.claim wiring, an installed
 * PWA on a user's home screen can keep serving stale UI for days. The
 * normal "kill app + reopen" dance doesn't always trigger a SW update on
 * iOS in particular.
 *
 * This page is the nuclear option. When opened (ideally from the mobile
 * browser, NOT the installed PWA), it:
 *   1. Unregisters every service worker registered for this origin.
 *   2. Deletes every cache the browser holds for this origin.
 *   3. Bumps a localStorage version stamp so other tabs notice.
 *   4. Redirects to /dashboard with a cache-busting query param so the
 *      next navigation gets fresh HTML and re-installs the new SW from
 *      scratch.
 *
 * Routine for stuck phones:
 *   - User opens https://pathway-crm.vercel.app/refresh in their mobile
 *     browser (Safari/Chrome, not the PWA shortcut).
 *   - Page does its work and redirects to /dashboard.
 *   - User then reopens the PWA from the home screen — fresh state.
 *
 * Safe to leave deployed permanently; runs only on demand.
 */
'use client';

import { useEffect, useState } from 'react';

export default function RefreshPage() {
  const [step, setStep] = useState('Starting...');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStep('Unregistering service workers...');
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (cancelled) return;

        setStep('Clearing caches...');
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        if (cancelled) return;

        setStep('Resetting local state...');
        try {
          // Bump a version stamp so any open tab using a 'version mismatch'
          // detector picks it up. Don't blow away other localStorage keys —
          // we don't want to log the user out as a side effect of a refresh.
          window.localStorage.setItem('pi-crm-refresh-stamp', String(Date.now()));
        } catch {
          // localStorage can throw in private mode / quota issues — non-fatal.
        }
        if (cancelled) return;

        setStep('Done. Redirecting...');
        setDone(true);

        // Cache-bust the next navigation. The query param forces a new
        // entry in any HTTP-cache keying that includes URL params, and
        // helps debug-side users see they really got a fresh load.
        const target = `/dashboard?refreshed=${Date.now()}`;
        // Small delay so the user sees confirmation before the redirect.
        setTimeout(() => {
          // location.replace so the /refresh URL doesn't sit in history.
          window.location.replace(target);
        }, 800);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 p-6">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl shadow-md border border-gray-200 dark:border-slate-800 p-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          🔄 Refreshing app
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Clearing local cache and updating to the latest version. This usually takes a couple of seconds.
        </p>
        <div className="flex items-center gap-2 text-sm">
          {!done && !error && (
            <span className="inline-block w-3 h-3 rounded-full bg-green-500 animate-pulse" />
          )}
          {done && !error && (
            <span className="inline-block w-3 h-3 rounded-full bg-green-600" />
          )}
          {error && (
            <span className="inline-block w-3 h-3 rounded-full bg-red-500" />
          )}
          <span className="text-gray-700 dark:text-gray-200">
            {error ? `Error: ${error}` : step}
          </span>
        </div>

        {error && (
          <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            If this keeps failing, fully close the browser tab and reopen
            <span className="font-mono"> /dashboard</span>, or remove and re-add the home-screen shortcut.
          </div>
        )}
      </div>
    </div>
  );
}
