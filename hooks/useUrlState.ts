'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Saves and restores scroll position per page using sessionStorage.
 * Pass `ready=false` while data is still loading so restore waits until the page is tall enough.
 */
export function useScrollRestore(ready: boolean = true) {
  const pathname = usePathname();
  const key = `scroll_${pathname}`;
  const restoredRef = useRef(false);

  // Save scroll position continuously and on unmount
  useEffect(() => {
    function save() {
      // Only save once we've actually restored — otherwise we'd overwrite the saved
      // value with 0 before the user has a chance to scroll.
      if (restoredRef.current) {
        sessionStorage.setItem(key, String(window.scrollY));
      }
    }
    window.addEventListener('beforeunload', save);
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      window.removeEventListener('beforeunload', save);
      window.removeEventListener('scroll', save);
    };
  }, [key]);

  // Restore scroll once data is ready. We wait 80ms after `ready` flips true
  // so the list rows have a chance to paint and the document grows tall enough
  // for the saved scrollY to be reachable.
  useEffect(() => {
    if (!ready || restoredRef.current) return;
    const saved = sessionStorage.getItem(key);
    if (!saved) {
      restoredRef.current = true;
      return;
    }
    const y = parseInt(saved);
    const t = setTimeout(() => {
      window.scrollTo(0, y);
      restoredRef.current = true;
    }, 80);
    return () => clearTimeout(t);
  }, [key, ready]);
}

/**
 * Persist a filter value in sessionStorage so it survives back-navigation.
 */
export function useFilterState<T>(filterKey: string, defaultValue: T): [T, (v: T) => void] {
  const pathname = usePathname();
  const storageKey = `filter_${pathname}_${filterKey}`;

  const getStored = useCallback((): T => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : defaultValue;
    } catch { return defaultValue; }
  }, [storageKey, defaultValue]);

  const setValue = useCallback((v: T) => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(v)); } catch { /* */ }
  }, [storageKey]);

  return [getStored(), setValue];
}
