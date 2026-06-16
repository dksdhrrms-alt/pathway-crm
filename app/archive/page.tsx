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

import { useState, useMemo, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import TopBar from '@/app/components/TopBar';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import EmptyState from '@/app/components/EmptyState';
import ExportButton, { ExportColumn } from '@/app/components/ExportButton';
import EditActivityModal from '@/app/components/EditActivityModal';
import type { Activity } from '@/lib/data';
import { getCommentCounts } from '@/lib/comments';

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
  const me = users.find((u) => u.id === sessionUserId);
  // Admin-style roles: see anyone in the company.
  const isAdminLike = ['admin', 'administrative_manager', 'ceo', 'coo'].includes(role);
  // Team-level viewers: see their own team only. Sales Directors and
  // Technical Managers both fall in this tier — the `team` field on
  // the user matches against teammates' team field. Members without a
  // team set are treated as having no extra access (fall back to
  // "just me").
  const isSalesDirector = role === 'sales_director';
  const isTeamViewer = isSalesDirector || role === 'technical_manager';
  const myTeam = (me as { team?: string } | undefined)?.team ?? '';
  const canPickOthers = isAdminLike || (isTeamViewer && !!myTeam);

  // Which users this viewer is *allowed* to inspect. Always includes
  // themselves so they can include their own activities in the multi-select.
  const allowedUsers = useMemo(() => {
    if (isAdminLike) return users;
    if (isTeamViewer && myTeam) {
      return users.filter((u) => (u as { team?: string }).team === myTeam || u.id === sessionUserId);
    }
    return users.filter((u) => u.id === sessionUserId);
  }, [users, isAdminLike, isTeamViewer, myTeam, sessionUserId]);

  // Multi-select: a Set of user IDs whose archives we're merging into
  // the table. Default is "just me" — opens to a familiar view.
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(() => new Set([sessionUserId]));
  // Picker dropdown open state.
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  // Close the dropdown when clicking outside.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function toggleUser(id: string) {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Don't allow zero selections — fall back to just-me.
        if (next.size === 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  function selectAllUsers() {
    setSelectedUserIds(new Set(allowedUsers.map((u) => u.id)));
  }
  function selectJustMe() {
    setSelectedUserIds(new Set([sessionUserId]));
  }
  // Activity that's currently being edited. null = no modal open. Click a
  // row in the table to set this; the modal handles save/delete via
  // CRMContext.updateActivity / deleteActivity (both optimistic).
  const [editing, setEditing] = useState<Activity | null>(null);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  // Unassigned-only filter — surfaces inbound emails the parser couldn't
  // confidently route. Activated by URL `?filter=unassigned` (NotificationBell
  // bell badge links here) or by toggling the chip in the filter row.
  //
  // We deliberately initialize to `false` and read the URL in an effect.
  // Reading window.location inside the useState initializer would diverge
  // between server prerender (no window → false) and client hydration
  // (with ?filter=unassigned → true), tripping React's hydration check.
  // Starting consistent on both sides and flipping after mount avoids
  // that mismatch — the toggle is just one render later.
  const [unassignedOnly, setUnassignedOnly] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('filter') === 'unassigned') {
      setUnassignedOnly(true);
    }
  }, []);

  // Pickable users — allowedUsers filtered to active and sorted by name.
  // (Inactive users would still match historical activities, but they
  // clutter the picker.)
  const pickableUsers = useMemo(
    () => allowedUsers.filter((u) => u.status === 'active').sort((a, b) => a.name.localeCompare(b.name)),
    [allowedUsers],
  );

  // Header / export labelling. When one user is selected, name them.
  // When many, give a count.
  const selectedNames = useMemo(() => {
    return pickableUsers.filter((u) => selectedUserIds.has(u.id)).map((u) => u.name);
  }, [pickableUsers, selectedUserIds]);
  const targetUserName = selectedNames.length === 1
    ? selectedNames[0]
    : selectedNames.length === 0
      ? '(nobody)'
      : `${selectedNames.length} users`;
  const targetUserEmail = selectedNames.length === 1
    ? (pickableUsers.find((u) => selectedUserIds.has(u.id))?.email ?? '')
    : '';
  // For per-row "Owner" labels in the table when multiple users are picked.
  const userNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.name);
    return m;
  }, [users]);

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

  // Filter pipeline: owner (multi) → date range → keyword. Sorted newest first.
  // When the viewer isn't allowed to pick others, force-filter to their own
  // id so they can't see other users' rows even if state somehow includes them.
  const filtered = useMemo(() => {
    const ownerSet = canPickOthers ? selectedUserIds : new Set([sessionUserId]);
    const needle = search.trim().toLowerCase();
    return activities
      .filter((a) => ownerSet.has(a.ownerId))
      .filter((a) => {
        if (fromDate && a.date < fromDate) return false;
        if (toDate && a.date > toDate) return false;
        if (unassignedOnly) {
          // Unassigned = any Email activity missing a contact. The
          // account may have been inferred by the domain fallback,
          // but a human still needs to pick the specific person.
          if (a.type !== 'Email') return false;
          if (a.contactId) return false;
        }
        if (needle) {
          const hay = (a.subject + ' ' + (a.description ?? '')).toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [activities, canPickOthers, selectedUserIds, sessionUserId, fromDate, toDate, search, unassignedOnly]);

  // Type tally chips above the table. Keeps the user oriented when filters
  // are applied — they can see at a glance how many of each kind survived.
  const typeCounts = useMemo(() => {
    const m: Record<string, number> = { Call: 0, Meeting: 0, Email: 0, Note: 0 };
    for (const a of filtered) m[a.type] = (m[a.type] ?? 0) + 1;
    return m;
  }, [filtered]);

  // Comment counts per activity id, fetched in a single round-trip after
  // the filtered list settles. Re-fetches when the user closes the edit
  // modal so newly-added replies are reflected immediately. Falls back to
  // an empty map on error (no badge shown).
  const [commentCountById, setCommentCountById] = useState<Record<string, number>>({});
  const [reloadCountsToken, setReloadCountsToken] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const ids = filtered.map((a) => a.id);
    if (ids.length === 0) { setCommentCountById({}); return; }
    getCommentCounts('activity', ids).then((counts) => {
      if (!cancelled) setCommentCountById(counts);
    });
    return () => { cancelled = true; };
  }, [filtered, reloadCountsToken]);

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
    { id: 'owner',       label: 'Logged By',   getValue: (r) => userNameById.get(r.ownerId) ?? '—' },
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
                Every activity logged in the CRM by {canPickOthers ? (selectedUserIds.size === 1 ? 'the selected user' : `${selectedUserIds.size} selected users`) : 'you'}.
                {isAdminLike && (
                  <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">(Admin view — you can browse any user&apos;s archive)</span>
                )}
                {isTeamViewer && !isAdminLike && (
                  <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">(Team view — you can browse your team&apos;s archives)</span>
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
              {/* User multi-select picker (admin-likes + sales directors
                  who have a team). Built as a custom dropdown because the
                  native <select multiple> behaves clunkily on touch and
                  doesn't show selected names. */}
              {canPickOthers && (
                <div className="md:col-span-3 relative" ref={pickerRef}>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Users ({selectedUserIds.size} selected)
                  </label>
                  <button
                    type="button"
                    onClick={() => setPickerOpen((o) => !o)}
                    className="w-full flex items-center justify-between gap-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <span className="truncate text-left">
                      {selectedNames.length === 0 ? '— Pick users —'
                        : selectedNames.length === 1 ? selectedNames[0]
                        : selectedNames.length <= 3 ? selectedNames.join(', ')
                        : `${selectedNames.length} users selected`}
                    </span>
                    <svg className={`w-4 h-4 transition-transform flex-shrink-0 ${pickerOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {pickerOpen && (
                    <div className="absolute z-30 mt-1 w-72 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-72 overflow-y-auto">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-slate-800 text-xs">
                        <button type="button" onClick={selectAllUsers} className="text-green-700 dark:text-green-400 hover:underline">Select all</button>
                        <button type="button" onClick={selectJustMe} className="text-gray-500 dark:text-gray-400 hover:underline">Just me</button>
                      </div>
                      {pickableUsers.map((u) => {
                        const checked = selectedUserIds.has(u.id);
                        return (
                          <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleUser(u.id)}
                              className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-green-600 focus:ring-green-500"
                            />
                            <span className="text-sm text-gray-900 dark:text-gray-100">
                              {u.name}{u.id === sessionUserId ? ' (me)' : ''}
                            </span>
                          </label>
                        );
                      })}
                      {pickableUsers.length === 0 && (
                        <div className="px-3 py-3 text-xs italic text-gray-500 dark:text-gray-400">
                          No team members to show.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className={canPickOthers ? 'md:col-span-2' : 'md:col-span-3'}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className={canPickOthers ? 'md:col-span-2' : 'md:col-span-3'}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className={canPickOthers ? 'md:col-span-4' : 'md:col-span-5'}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Search subject / description</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. trial, follow up, Ron"
                  className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className={(canPickOthers ? 'md:col-span-1' : 'md:col-span-1') + ' flex items-end gap-2'}>
                <button
                  type="button"
                  onClick={() => setUnassignedOnly((v) => !v)}
                  title={unassignedOnly
                    ? 'Showing only inbound emails without a contact. Click to clear.'
                    : 'Show only inbound emails where the parser could not auto-match a contact.'}
                  className={
                    'px-3 py-2 text-sm rounded-lg border whitespace-nowrap ' +
                    (unassignedOnly
                      ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/60'
                      : 'border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800')
                  }
                >
                  {unassignedOnly ? '✓ Unassigned' : 'Unassigned'}
                </button>
                <button
                  type="button"
                  onClick={() => { setUnassignedOnly(false); resetFilters(); }}
                  className="px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
                  title="Clear all filters"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Summary chips */}
          <div className="flex flex-wrap items-center gap-2 mb-2 text-sm">
            <span className="text-gray-700 dark:text-gray-200 font-medium">
              {filtered.length} record{filtered.length === 1 ? '' : 's'}
            </span>
            {targetUserEmail && (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="text-gray-500 dark:text-gray-400 truncate">{targetUserEmail}</span>
              </>
            )}
            {selectedNames.length > 1 && (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="text-gray-500 dark:text-gray-400 truncate" title={selectedNames.join(', ')}>{selectedNames.length} users</span>
              </>
            )}
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className={`px-2 py-0.5 rounded text-xs ${TYPE_BADGE_BG.Call}`}>📞 {typeCounts.Call}</span>
            <span className={`px-2 py-0.5 rounded text-xs ${TYPE_BADGE_BG.Meeting}`}>🤝 {typeCounts.Meeting}</span>
            <span className={`px-2 py-0.5 rounded text-xs ${TYPE_BADGE_BG.Email}`}>📧 {typeCounts.Email}</span>
            <span className={`px-2 py-0.5 rounded text-xs ${TYPE_BADGE_BG.Note}`}>📝 {typeCounts.Note}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Click any row to edit the activity.
          </p>

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
                      {selectedUserIds.size > 1 && <th className="text-left px-4 py-3 font-semibold">Owner</th>}
                      <th className="text-left px-4 py-3 font-semibold">Subject</th>
                      <th className="text-center px-2 py-3 font-semibold" title="Reply count">💬</th>
                      <th className="text-left px-4 py-3 font-semibold">Account</th>
                      <th className="text-left px-4 py-3 font-semibold">Contact</th>
                      <th className="text-left px-4 py-3 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {filtered.map((a) => (
                      <tr
                        key={a.id}
                        onClick={() => setEditing(a)}
                        className="hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                        title="Click to edit"
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-200">{formatDate(a.date)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_BADGE_BG[a.type] ?? 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300'}`}>
                            {a.type}
                          </span>
                        </td>
                        {selectedUserIds.size > 1 && (
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-200 max-w-[14ch] truncate" title={userNameById.get(a.ownerId) ?? '—'}>
                            {userNameById.get(a.ownerId) ?? '—'}
                          </td>
                        )}
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium max-w-xs truncate" title={a.subject}>
                          {a.subject}
                        </td>
                        <td className="px-2 py-3 text-center whitespace-nowrap">
                          {(commentCountById[a.id] ?? 0) > 0 ? (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                              title={`${commentCountById[a.id]} repl${commentCountById[a.id] === 1 ? 'y' : 'ies'}`}
                            >
                              <span aria-hidden>💬</span>
                              <span>{commentCountById[a.id]}</span>
                            </span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-700 text-[11px]">—</span>
                          )}
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

      {editing && (
        <EditActivityModal
          activity={editing}
          onClose={() => {
            setEditing(null);
            // Force a count re-fetch so reply badges reflect any threads
            // the user just opened/added inside the modal.
            setReloadCountsToken((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
