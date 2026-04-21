'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Global scroll restorer.
 *
 * Next.js App Router automatically scrolls the window to (0,0) on every
 * client-side navigation. That fires AFTER React commits, which means a
 * per-page useEffect that calls scrollTo on mount gets immediately
 * overridden by Next's reset.
 *
 * This component sits in the root layout and:
 *  1. Continuously saves window.scrollY for the current pathname.
 *  2. On pathname change, runs scrollTo a few times at increasing delays —
 *     each one runs *after* Next's scroll reset, and after data-loaded
 *     list rows have grown the document tall enough to reach the saved Y.
 */
export default function ScrollRestorer() {
  const pathname = usePathname();
  const lastSaveRef = useRef<number>(0);

  // Save scroll position on every scroll, throttled.
  useEffect(() => {
    const key = `scroll_${pathname}`;
    function save() {
      const now = Date.now();
      if (now - lastSaveRef.current < 100) return;
      lastSaveRef.current = now;
      sessionStorage.setItem(key, String(window.scrollY));
    }
    function saveImmediate() {
      sessionStorage.setItem(key, String(window.scrollY));
    }
    window.addEventListener('scroll', save, { passive: true });
    window.addEventListener('beforeunload', saveImmediate);
    return () => {
      // Persist final position when unmounting / pathname changes
      saveImmediate();
      window.removeEventListener('scroll', save);
      window.removeEventListener('beforeunload', saveImmediate);
    };
  }, [pathname]);

  // Restore scroll on pathname change. Multiple attempts at increasing delays
  // handle the case where the list is still hydrating / fetching from Supabase.
  useEffect(() => {
    const key = `scroll_${pathname}`;
    const saved = sessionStorage.getItem(key);
    if (!saved) return;
    const y = parseInt(saved);
    if (isNaN(y) || y <= 0) return;

    // 80ms — first attempt after Next.js scroll reset + initial paint
    // 250ms / 600ms — for pages whose data loads asynchronously
    const delays = [80, 250, 600];
    const timers = delays.map((d) =>
      setTimeout(() => {
        const maxY = document.documentElement.scrollHeight - window.innerHeight;
        if (maxY >= y - 4) {
          window.scrollTo(0, y);
        }
      }, d)
    );
    return () => timers.forEach(clearTimeout);
  }, [pathname]);

  return null;
}
