'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import QuickLogFAB from './QuickLogFAB';
import GlobalSearch from './GlobalSearch';

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const noSidebarPages = ['/login', '/signup'];
  if (noSidebarPages.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <>
      <Sidebar />
      <div className="md:ml-60 min-h-screen flex flex-col">
        {children}
      </div>
      <QuickLogFAB />
      <GlobalSearch />
    </>
  );
}
