'use client';

import { useState, useEffect } from 'react';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useMenuAccess } from '@/hooks/useMenuAccess';

const navItems = [
  { href: '/dashboard', label: 'Home', icon: HomeIcon },
  { href: '/accounts', label: 'Accounts', icon: AccountsIcon },
  { href: '/contacts', label: 'Contacts', icon: ContactsIcon },
  { href: '/opportunities', label: 'Opportunities', icon: OppsIcon },
  { href: '/tasks', label: 'Tasks', icon: TasksIcon },
];

function HomeIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

function AccountsIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}

function ContactsIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function OppsIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

function ReportsIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function SalesIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ScanCardIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function InsightsIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;
}
function AdminIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

const PRIMARY_COLOR = '#1a3a5c';

const salesDashSubItems = [
  { href: '/sales-dashboard/all', label: 'All' },
  { href: '/sales-dashboard/monogastrics', label: 'Monogastrics' },
  { href: '/sales-dashboard/ruminants', label: 'Ruminants' },
  { href: '/sales-dashboard/latam', label: 'LATAM' },
  { href: '/sales-dashboard/familyb2b', label: 'Family / B2B' },
];

const menuMap: Record<string, string> = {
  '/dashboard': 'Home', '/accounts': 'Accounts', '/contacts': 'Contacts',
  '/opportunities': 'Opportunities', '/tasks': 'Tasks', '/reports': 'Reports',
  '/sales': 'Sales', '/admin': 'Admin',
};

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [salesDashOpen, setSalesDashOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(pathname.startsWith('/reports'));
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const { canAccess } = useMenuAccess();

  // Swipe right to open sidebar on mobile
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    function onTouchStart(e: TouchEvent) { startX = e.touches[0].clientX; startY = e.touches[0].clientY; }
    function onTouchEnd(e: TouchEvent) {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = Math.abs(e.changedTouches[0].clientY - startY);
      if (startX < 30 && dx > 60 && dy < 50) setMobileOpen(true);
      if (mobileOpen && dx < -60 && dy < 50) setMobileOpen(false);
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => { window.removeEventListener('touchstart', onTouchStart); window.removeEventListener('touchend', onTouchEnd); };
  }, [mobileOpen]);

  const isAdminRole = ['admin', 'administrative_manager', 'ceo'].includes(role);

  const isSalesDashActive = pathname.startsWith('/sales-dashboard');

  // Build menu from navItems + permission check
  const menuMap: Record<string, string> = {
    '/dashboard': 'home', '/accounts': 'accounts', '/contacts': 'contacts',
    '/opportunities': 'opportunities', '/tasks': 'tasks', '/reports': 'reports',
    '/insights': 'reports', '/scan-card': 'contacts', '/sales': 'sales', '/admin': 'admin',
  };

  const allItems = [
    ...navItems,
    { href: '/reports' as const, label: 'Reports', icon: ReportsIcon },
    { href: '/insights' as const, label: 'Insights', icon: InsightsIcon },
    { href: '/scan-card' as const, label: 'Scan Card', icon: ScanCardIcon },
    { href: '/sales' as const, label: 'Sales', icon: SalesIcon },
    { href: '/admin' as const, label: 'Admin', icon: AdminIcon },
  ];

  const items = allItems
    .filter((item, idx, arr) => arr.findIndex((i) => i.href === item.href) === idx)
    .filter((item) => canAccess(menuMap[item.href] ?? item.label.toLowerCase()));

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
    return pathname.startsWith(href);
  }

  const sidebarContent = (
    <div className="flex flex-col h-screen" style={{ backgroundColor: PRIMARY_COLOR }}>
      {/* Logo / Brand */}
      <div className="px-4 py-5 border-b border-white/10 flex items-center justify-center">
        <div className="text-center">
          <span className="text-white font-bold text-base block" style={{ letterSpacing: '-0.3px', lineHeight: '1.2' }}>Pathway</span>
          <span className="text-white font-bold text-base block" style={{ letterSpacing: '-0.3px', lineHeight: '1.2' }}>Intermediates</span>
          <span className="block mt-0.5 text-xs font-medium tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.6)' }}>USA</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {items.filter((i) => i.href !== '/reports').map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
              isActive(href)
                ? 'bg-white/15 text-white'
                : 'text-white/60 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon />
            {label}
            {label === 'Admin' && (
              <span className="ml-auto text-xs bg-white/20 text-white px-1.5 py-0.5 rounded font-medium">
                Admin
              </span>
            )}
          </Link>
        ))}

        {/* Reports — expandable sub-menu */}
        {canAccess('reports') && (
          <div>
            <button
              onClick={() => setReportsOpen(!reportsOpen)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                pathname.startsWith('/reports') ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              <ReportsIcon />
              <span>Reports</span>
              <span className="ml-auto text-[10px] opacity-70" style={{ transform: reportsOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', display: 'inline-block' }}>▼</span>
            </button>
            {reportsOpen && (
              <div className="ml-4 mt-1 space-y-0.5">
                {[
                  { href: '/reports/ceo', label: 'CEO Report', icon: '🏢', adminOnly: true },
                  { href: '/reports/monogastrics', label: 'Monogastrics', icon: '🐔', adminOnly: false },
                  { href: '/reports/ruminants', label: 'Ruminants', icon: '🐄', adminOnly: false },
                  { href: '/reports/latam', label: 'LATAM', icon: '🌎', adminOnly: false },
                ].filter((item) => !item.adminOnly || isAdminRole)
                .map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-[13px] transition-all ${
                      pathname === item.href ? 'bg-white/20 text-white font-medium' : 'text-white/60 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span style={{ fontSize: '14px' }}>{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sales Dashboard — collapsible */}
        {canAccess('sales_dashboard') && <div>
          <button
            onClick={() => setSalesDashOpen(!salesDashOpen)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
              isSalesDashActive ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Sales Dashboard
            <svg className={`w-4 h-4 ml-auto transition-transform ${salesDashOpen || isSalesDashActive ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {(salesDashOpen || isSalesDashActive) && (
            <div className="ml-8 mt-1 space-y-0.5">
              {salesDashSubItems.map((sub) => (
                <Link
                  key={sub.href}
                  href={sub.href}
                  onClick={() => setMobileOpen(false)}
                  className={`block px-3 py-1.5 rounded-md text-sm transition-all ${
                    pathname === sub.href ? 'bg-white/15 text-white font-medium' : 'text-white/50 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {sub.label}
                </Link>
              ))}
            </div>
          )}
        </div>}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-white/10">
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white transition-all"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign out
        </button>
        <div className="px-3 pt-2 pb-1">
          <p className="text-white/30 text-xs">CRM Platform v2.0_Powered by Dave AI</p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden md:flex fixed left-0 top-0 h-full flex-col z-30" style={{ width: 240 }}>
        {sidebarContent}
      </div>

      {/* Mobile hamburger */}
      <button
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg text-white"
        style={{ backgroundColor: PRIMARY_COLOR }}
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="md:hidden fixed left-0 top-0 h-full z-50" style={{ width: 240 }}>
            {sidebarContent}
          </div>
        </>
      )}
    </>
  );
}
