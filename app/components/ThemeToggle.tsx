'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

/**
 * Light / dark theme toggle — pure two-state toggle, no "system" stop in
 * the middle (users found the monitor icon noisy because it forced a 3rd
 * click to get back to where they wanted).
 *
 * The initial preference still respects the OS via next-themes' default
 * `defaultTheme="system"`; this button only flips between explicit
 * 'light' and 'dark' once the user touches it.
 *
 * The mounted-flag dance is the standard SSR pattern: until the client
 * hydrates we don't know what theme is actually showing, so we render a
 * same-size placeholder to avoid layout shift and hydration mismatch.
 */
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div aria-hidden="true" className="w-9 h-9" />;
  }

  // resolvedTheme is the *actual* theme being shown ('light' | 'dark'),
  // even when the user's preference is 'system'.
  const isDark = resolvedTheme === 'dark';
  const label = `Switch to ${isDark ? 'light' : 'dark'} mode`;

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={label}
      aria-label={label}
      className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-slate-800 transition-colors"
    >
      {isDark ? (
        // Sun icon — clicking will switch to light
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      ) : (
        // Moon icon — clicking will switch to dark
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      )}
    </button>
  );
}
