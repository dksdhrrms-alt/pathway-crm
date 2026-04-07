'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { useUsers } from '@/lib/UserContext';
import { getRoleLabel } from '@/lib/users';
import NotificationBell from './NotificationBell';

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
      className="fixed top-0 right-0 z-20 flex items-center justify-between px-4 md:px-6 py-3 bg-white border-b border-gray-200 shadow-sm left-0 md:left-60"
    >
      {/* Search — hidden on mobile */}
      <div className="relative w-72 hidden md:block">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:bg-white transition"
        />
      </div>

      {/* Notifications + User avatar */}
      <div className="relative flex items-center gap-3" ref={dropdownRef}>
        <NotificationBell />
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-sm text-gray-600">{userName}</span>
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
            <img src={profilePhoto} alt={userName} className="w-9 h-9 rounded-full object-cover" />
          ) : (
            initials
          )}
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-12 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1">
            {/* User info header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 overflow-hidden"
                style={{ backgroundColor: profilePhoto ? 'transparent' : avatarColor }}
              >
                {profilePhoto ? (
                  <img src={profilePhoto} alt={userName} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{userName}</p>
                <p className="text-xs text-gray-500 truncate">{session?.user?.email}</p>
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
              className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Edit Profile
            </Link>

            {/* Sign out */}
            <button
              onClick={() => { setDropdownOpen(false); signOut({ callbackUrl: '/login' }); }}
              className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors border-t border-gray-100"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
