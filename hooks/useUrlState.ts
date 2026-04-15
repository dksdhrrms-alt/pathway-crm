'use client';

import { useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Saves and restores scroll position per page using sessionStorage.
 * Call once in each list page.
 */
export function useScrollRestore() {
  const pathname = usePathname();
  const key = `scroll_${pathname}`;

  useEffect(() => {
    // Restore scroll position on mount
    const saved = sessionStorage.getItem(key);
    if (saved) {
      const y = parseInt(saved);
      setTimeout(() => window.scrollTo(0, y), 50);
    }

    // Save scroll position on unmount / navigation
    function save() {
      sessionStorage.setItem(key, String(window.scrollY));
    }

    window.addEventListener('beforeunload', save);
    return () => {
      save();
      window.removeEventListener('beforeunload', save);
    };
  }, [key]);
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
