'use client';

/**
 * PresenceHeartbeat — fire-and-forget client component that pings
 * /api/me/seen every minute while the tab is visible. Mounted once
 * in TopBar (which is on every authenticated page), so any user
 * browsing the CRM keeps users.last_seen_at fresh — and the admin
 * Team Overview can show a meaningful "Last Active" timestamp
 * instead of relying on the credentials-only Last Login.
 *
 * Behaviors:
 *   - Pings immediately on mount (so navigating in counts).
 *   - Pings on every visibilitychange when the tab comes back.
 *   - Otherwise polls every 60s while visible.
 *   - Silent failures — this is presence telemetry, not user-facing.
 */
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';

const PING_INTERVAL_MS = 60_000;

export default function PresenceHeartbeat() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;

    async function ping() {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        await fetch('/api/me/seen', { method: 'POST', cache: 'no-store' });
      } catch {
        // network blip / sign-out — swallow, this is best-effort.
      }
    }

    // Fire once on mount, then poll. visibilitychange catches the
    // "user left for an hour and came back" case so the column flips
    // without waiting for the next poll tick.
    ping();
    const interval = setInterval(ping, PING_INTERVAL_MS);
    const onVis = () => { if (!document.hidden) ping(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [status]);

  return null;
}
