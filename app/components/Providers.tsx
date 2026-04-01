'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { UserProvider } from '@/lib/UserContext';
import { CRMProvider } from '@/lib/CRMContext';
import LayoutShell from './LayoutShell';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <UserProvider>
        <CRMProvider>
          <LayoutShell>{children}</LayoutShell>
        </CRMProvider>
      </UserProvider>
    </SessionProvider>
  );
}
