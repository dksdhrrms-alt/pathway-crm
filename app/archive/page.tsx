'use client';

/**
 * /archive — personal activity log.
 *
 * Every user can see their own activities here (default view).
 * Admins/CEO/Administrative-Manager can additionally pick another user
 * from a dropdown to view that person's archive (audit/backup use case).
 *
 * Filters: date range (from / to) + free-text search across subject + description.
 *
 * Export: reuses the shared ExportButton (Excel / CSV / PDF), with the
 * Excel sheet name "Activities — <userName>".
 *
 * Activities pulled from CRMContext (already memoized + Realtime-synced),
 * so opening this page is essentially zero-cost — no extra fetch.
 */

import { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import TopBar from '@/app/components/TopBar';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import EmptyState from '@/app/components/EmptyState';
import ExportButton, { ExportColumn } from '@/app/components/ExportButton';
import type { Activity } from '@/lib/data';

const TYPE_BADGE_BG: Record<string, string> = {
  Call:    'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  Meeting: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
  Email:   'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
  Note:    'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300',
};

function formatDate(d: string): string {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function ArchivePage() {
  const { data: session } = useSession();
  const { activities, accounts, contacts, loading } = useCRM();
  const { users } = useUsers();

  const sessionUserId = session?.user?.id ?? '';
  const role = ((session?.user as { role?: string })?.role ?? '').toLowerCase();
  // Admin-style roles can view anyone's archive via the user picker.
  // Everyone else is locked to their own — selectedUserId state is
  // initialized to their session id and the picker is hidden.
  const isAdminLike = ['admin', 'administrative_manager', 'ceo'].includes(role);

  const [selectedUserId, setSelectedUserId] = useState<string>(sessionUserId);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  // The actual user we're showing the archive for.
  const targetUser = useMemo(
    () => users.find((u) => u.id === (isAdminLike ? selectedUserId : sessionUserId)) ?? null,
    [users, selectedUserId, sessionUserId, isAdminLike],
  );
  const targetUserName = targetUser?.name ?? '(unknown user)';
  const targetUserEmail = targetUser?.email ?? '';

  // Sort active users for the picker. We hide inactive ones to keep the
  // dropdown focused on real teammates.
  const pickableUsers = useMemo(
    () => users.filter((u) => u.status === 'active').sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  // Account / contact lookup maps for label rendering (and Excel columns).
  const accountById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.name);
    return m;
  }, [accounts]);

  const contactById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts) m.set(c.id, `${c.firstName} ${c.lastName}`.trim());
    return m;
  }, [contacts]);

  // Filter pipeline: owner → date range → keyword. Sorted newest first.
  const filtered = useMemo(() => {
    const ownerId = isAdminLike ? selectedUserId : sessionUserId;
    const needle = search.trim().toLowerCase();
    return activities
      .filter((a) => a.ownerId === ownerId)
      .filter((a) => {
        if (fromDate && a.date < fromDate) return false;
        if (toDate && a.date > toDate) return false;
        if (needle) {
          const hay = (a.subject + ' ' + (a.description ?? '')).toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [activities, isAdminLike, selectedUserId, sessionUserId, fromDate, toDate, search]);

  // Type tally chips above the table. Keeps the user oriented when filters
  // are applied — they can see at a glance how many of each kind survived.
  const typeCounts = useMemo(() => {
    const m: Record<string, number> = { Call: 0, Meeting: 0, Email: 0, Note: 0 };
    for (const a of filtered) m[a.type] = (m[a.type] ?? 0) + 1;
    return m;
  }, [filtered]);

  // Excel/CSV/PDF columns. Account / contact are joined to human names
  // here so the exported file is self-contained — no IDs the user has to
  // look up in another sheet.
  const exportColumns: ExportColumn<Activity>[] = [
    { id: 'date',        label: 'Date',        getValue: (r) => r.date ?? '' },
    { id: 'type',        label: 'Type',        getValue: (r) => r.type },
    { id: 'subject',     label: 'Subject',     getValue: (r) => r.subject ?? '' },
    { id: 'description', label: 'Description', getValue: (r) => r.description ?? '' },
    { id: 'purpose',     label: 'Purpose',     getValue: (r) => r.purpose ?? '' },
    { id: 'account',     label: 'Account',     getValue: (r) => accountById.get(r.accountId ?? '') ?? '' },
    { id: 'contact',     label: 'Contact',     getValue: (r) => contactById.get(r.contactId ?? '') ?? '' },
    { id: 'owner',       label: 'Logged By',   getValue: () => targetUserName },
  ];

  const exportFilename = `archive-activities-${(targetUserName || 'user').replace(/\s+/g, '_')}-${new Date().toISOString().split('T')[0]}`;

  function resetFilters() {
    setFromDate('');
    setToDate('');
    setSearch('');
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar placeholder="Search archive..." />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="mt-6 mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">📂 Archive</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Every activity logged in the CRM by {isAdminLike ? 'the selected user' : 'you'}.
                {isAdminLike && (
                  <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">(Admin view — you can browse any user&apos;s archive)</span>
                )}
              </p>
            </div>
            <ExportButton<Activity>
              filename={exportFilename}
              rows={filtered}
              columns={exportColumns}
              title={`Activities — ${targetUserName}`}
            />
          </div>

          {/* Filter bar */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm p-4 mb-5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              {/* User picker (admin only) */}
              {isAdminLike && (
                <div className="md:col-span-3">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">User</label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    {pickableUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}{u.id === sessionUserId ? ' (me)' : ''}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className={isAdminLike ? 'md:col-span-2' : 'md:col-span-3'}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className={isAdminLike ? 'md:col-span-2' : 'md:col-span-3'}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className={isAdminLike ? 'md:col-span-4' : 'md:col-span-5'}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Search subject / description</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. trial, follow up, Ron"
                  className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className={(isAdminLike ? 'md:col-span-1' : 'md:col-span-1') + ' flex items-end'}>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="w-full md:w-auto px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
                  title="Clear all filters"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Summary chips */}
          <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
            <span className="text-gray-700 dark:text-gray-200 font-medium">
              {filtered.length} record{filtered.length === 1 ? '' : 's'}
            </span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-gray-500 dark:text-gray-400 truncate">{targetUserEmail}</span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className={`px-2 py-0.5 rounded text-xs ${TYPE_BADGE_BG.Call}`}>📞 {typeCounts.Call}</span>
            <span className={`px-2 py-0.5 rounded text-xs ${TYPE_BADGE_BG.Meeting}`}>🤝 {typeCounts.Meeting}</span>
            <span className={`px-2 py-0.5 rounded text-xs ${TYPE_BADGE_BG.Email}`}>📧 {typeCounts.Email}</span>
            <span className={`px-2 py-0.5 rounded text-xs ${TYPE_BADGE_BG.Note}`}>📝 {typeCounts.Note}</span>
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
            {filtered.length === 0 ? (
              <EmptyState
                title="No activities found"
                description={
                  isAdminLike
                    ? `No activities for ${targetUserName} match the current filters.`
                    : 'You have no activities matching the current filters. Try widening the date range or clearing the search.'
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/50 text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Date</th>
                      <th className="text-left px-4 py-3 font-semibold">Type</th>
                      <th className="text-left px-4 py-3 font-semibold">Subject</th>
                      <th className="text-left px-4 py-3 font-semibold">Account</th>
                      <th className="text-left px-4 py-3 font-semibold">Contact</th>
                      <th className="text-left px-4 py-3 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {filtered.map((a) => (
                      <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-200">{formatDate(a.date)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_BADGE_BG[a.type] ?? 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300'}`}>
                            {a.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium max-w-xs truncate" title={a.subject}>
                          {a.subject}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 max-w-[14ch] truncate" title={accountById.get(a.accountId ?? '') ?? ''}>
                          {accountById.get(a.accountId ?? '') ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 max-w-[14ch] truncate" title={contactById.get(a.contactId ?? '') ?? ''}>
                          {contactById.get(a.contactId ?? '') ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-md truncate" title={a.description ?? ''}>
                          {a.description || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
