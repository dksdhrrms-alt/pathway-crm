'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useUsers } from '@/lib/UserContext';
import { getRoleLabel } from '@/lib/users';
import NotificationBell from './NotificationBell';
import ThemeToggle from './ThemeToggle';
import { cacheClear } from '@/lib/cache';

interface TopBarProps {
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  placeholder?: string;
}

const PRIMARY_COLOR = '#1a3a5c';

const roleColors: Record<string, string> = {
  administrative_manager: '#1a4731',
  admin: '#1e40af',
  ceo: '#1a3a5c',
  sales_director: '#6d28d9',
  coo: '#4a1d96',
  sales: '#0369a1',
  marketing: '#92400e',
};

export default function TopBar({ searchValue, onSearchChange, placeholder = 'Search...' }: TopBarProps) {
  const [localSearch, setLocalSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { data: session } = useSession();
  const { currentUser } = useUsers();
  const pathname = usePathname();

  // Show search on mobile for list pages
  const showMobileSearch = ['/accounts', '/contacts', '/opportunities', '/tasks'].includes(pathname);

  const value = searchValue !== undefined ? searchValue : localSearch;
  const onChange = onSearchChange ?? setLocalSearch;

  const userName = currentUser?.name ?? session?.user?.name ?? '';
  const userRole = session?.user?.role ?? 'sales';

  const initials =
    currentUser?.initials ??
    (userName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'U');

  const profilePhoto = currentUser?.profilePhoto ?? null;
  const avatarColor = roleColors[userRole] ?? PRIMARY_COLOR;

  const badgeRoles = ['administrative_manager', 'admin', 'ceo', 'sales_director', 'coo'];
  const roleBadge = badgeRoles.includes(userRole)
    ? { label: getRoleLabel(userRole as import('@/lib/users').UserRole), color: roleColors[userRole] }
    : null;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div
      className="fixed top-0 right-0 z-20 flex items-center justify-between px-4 md:px-6 py-3 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 shadow-sm left-0 md:left-60 transition-colors"
    >
      {/* Search — visible on mobile for list pages */}
      <div className={`relative ${showMobileSearch ? 'flex-1 max-w-xs mr-2 md:max-w-none md:w-72 md:flex-none md:mr-0' : 'w-72 hidden md:block'}`}>
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 border border-gray-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:bg-white dark:focus:bg-slate-800 transition"
        />
      </div>

      {/* Notifications + Theme toggle + User avatar.
          ml-auto pins this group to the right edge even when the search
          input is hidden (mobile + Dashboard, which doesn't show search on
          phones). Without ml-auto, justify-between pulls the group toward
          the left when there's only one rendered sibling, which on mobile
          slid the ThemeToggle behind the sidebar's fixed hamburger button
          (z-50) — making the toggle invisible specifically on Dashboard
          while it stayed visible on other pages whose search box was
          rendered. ml-auto keeps everything right-aligned regardless. */}
      <div className="relative flex items-center gap-3 ml-auto" ref={dropdownRef}>
        {/* Pathway USA Library — bigger, more prominent link. Styled
            after the brand mark from the library site (book spines +
            backslash). Opens in a new tab so the CRM session stays put. */}
        <a
          href="https://pathway-library-flame.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-lg text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          title="Open Pathway USA Library in a new tab"
        >
          {/* Book-spines mark — three vertical bars + leaning slash, mirrors
              the logotype from the library site. */}
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="4"  y1="5" x2="4"  y2="19" />
            <line x1="8"  y1="5" x2="8"  y2="19" />
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="16" y1="5" x2="20" y2="19" />
          </svg>
          <span>Pathway USA Library</span>
        </a>
        {/* Mobile fallback — icon-only, same destination. */}
        <a
          href="https://pathway-library-flame.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="sm:hidden inline-flex items-center p-2 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          title="Open Pathway USA Library in a new tab"
          aria-label="Pathway USA Library"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="4"  y1="5" x2="4"  y2="19" />
            <line x1="8"  y1="5" x2="8"  y2="19" />
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="16" y1="5" x2="20" y2="19" />
          </svg>
        </a>
        <ThemeToggle />
        <NotificationBell />
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-300">{userName}</span>
          {roleBadge && (
            <span className="text-xs px-1.5 py-0.5 rounded font-semibold text-white" style={{ backgroundColor: roleBadge.color }}>
              {roleBadge.label}
            </span>
          )}
        </div>

        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-1 overflow-hidden"
          style={{ backgroundColor: profilePhoto ? 'transparent' : avatarColor }}
          aria-label="User menu"
        >
          {profilePhoto ? (
            <img src={profilePhoto} alt={userName} width={36} height={36} loading="lazy" decoding="async" className="w-9 h-9 rounded-full object-cover" />
          ) : (
            initials
          )}
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-12 w-64 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-lg z-50 py-1">
            {/* User info header */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 overflow-hidden"
                style={{ backgroundColor: profilePhoto ? 'transparent' : avatarColor }}
              >
                {profilePhoto ? (
                  <img src={profilePhoto} alt={userName} width={40} height={40} loading="lazy" decoding="async" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{userName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{session?.user?.email}</p>
                <span
                  className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium text-white"
                  style={{ backgroundColor: avatarColor }}
                >
                  {getRoleLabel(userRole as import('@/lib/users').UserRole)}
                </span>
              </div>
            </div>

            {/* Edit Profile */}
            <Link
              href="/profile"
              onClick={() => setDropdownOpen(false)}
              className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Edit Profile
            </Link>

            {/* Sign out */}
            <button
              onClick={() => {
                setDropdownOpen(false);
                // Clear the SWR cache so a different user signing in on
                // the same device doesn't briefly see the previous user's
                // data hydrated from localStorage.
                cacheClear();
                signOut({ callbackUrl: '/login' });
              }}
              className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors border-t border-gray-100 dark:border-slate-800"
            >
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
