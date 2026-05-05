'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from 'next-themes';
import { UserProvider } from '@/lib/UserContext';
import { CRMProvider } from '@/lib/CRMContext';
import LayoutShell from './LayoutShell';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    // ThemeProvider injects `class="dark"` (or "light") onto <html>. The
    // class-based strategy pairs with our @custom-variant in globals.css so
    // every `dark:` utility is scoped to that class. `defaultTheme="system"`
    // honors the OS preference until the user clicks the toggle.
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SessionProvider>
        <UserProvider>
          <CRMProvider>
            <LayoutShell>{children}</LayoutShell>
          </CRMProvider>
        </UserProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
