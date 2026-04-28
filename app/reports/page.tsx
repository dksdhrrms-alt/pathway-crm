'use client';

import React, { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { Activity, ActivityType } from '@/lib/data';
import { getRoleLabel, UserTeam } from '@/lib/users';
import TopBar from '@/app/components/TopBar';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

type DateRange = '7d' | '30d' | '90d' | 'custom';
type ActivityFilter = 'all' | ActivityType;

const TODAY_STR = new Date().toISOString().split('T')[0];
const TODAY = new Date();

function subtractDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const typeIcon: Record<ActivityType, string> = {
  Call: '📞',
  Meeting: '🤝',
  Email: '📧',
  Note: '📝',
};

const typeBg: Record<ActivityType, string> = {
  Call: 'bg-blue-100 text-blue-700',
  Meeting: 'bg-purple-100 text-purple-700',
  Email: 'bg-green-100 text-green-700',
  Note: 'bg-yellow-100 text-yellow-700',
};

function downloadCSV(activities: Activity[], getUserName: (id: string) => string, getAccountName: (id: string) => string, getContactName: (id?: string) => string) {
  const headers = ['Date', 'Type', 'Subject', 'Description', 'User', 'Account', 'Contact'];
  const rows = activities.map((a) => [
    a.date,
    a.type,
    `"${a.subject.replace(/"/g, '""')}"`,
    `"${(a.description ?? '').replace(/"/g, '""')}"`,
    getUserName(a.ownerId),
    getAccountName(a.accountId),
    getContactName(a.contactId),
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'activity-report.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export type ReportTeamFilter = 'all' | 'monogastrics' | 'ruminants' | 'latam';

const REPORT_TITLES: Record<ReportTeamFilter, { title: string; subtitle: string }> = {
  all: { title: 'CEO Report', subtitle: 'Company-wide activity across all teams' },
  monogastrics: { title: 'Monogastric Report', subtitle: 'Poultry & Swine team activity' },
  ruminants: { title: 'Ruminant Report', subtitle: 'Ruminants team activity' },
  latam: { title: 'LATAM Report', subtitle: 'LATAM team activity' },
};

export default function ReportsPage({ teamFilter = 'all' }: { teamFilter?: ReportTeamFilter }) {
  const { data: session } = useSession();
  const role = session?.user?.role ?? 'sales';
  const userId = session?.user?.id ?? '';

  const canViewAll = ['administrative_manager','admin','ceo','sales_director','coo'].includes(role ?? '');
  // Sales Director: individual breakdown only — hide By Team toggle.
  const isSalesDirector = role === 'sales_director';
  const MONO_GROUP = ['monogastrics', 'swine'];

  const { activities: allActivities, accounts, contacts, tasks: allTasks, opportunities: allOpps, saleRecords, salesBudgets, loading } = useCRM();
  const { users: allUsers } = useUsers();

  const activeUsers = useMemo(() => {
    const active = allUsers.filter((u) => u.status === 'active');
    if (teamFilter === 'all') return active;
    return active.filter((u) => {
      const uTeam = (u as { team?: string }).team ?? '';
      if (teamFilter === 'monogastrics') return MONO_GROUP.includes(uTeam);
      return uTeam === teamFilter;
    });
  }, [allUsers, teamFilter]);

  const { title: reportTitle, subtitle: reportSubtitle } = REPORT_TITLES[teamFilter];

  // Filters
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(TODAY_STR);
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [activityTypeFilter, setActivityTypeFilter] = useState<ActivityFilter>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'individual' | 'team'>('individual');
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());

  const [memberDetailTab, setMemberDetailTab] = useState<Record<string, 'activities' | 'tasks' | 'opportunities'>>({});

  function toggleTeam(id: string) { setExpandedTeams((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function toggleMember(id: string) { setExpandedMembers((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }

  const fromDate = useMemo(() => {
    if (dateRange === '7d') return subtractDays(TODAY, 7);
    if (dateRange === '30d') return subtractDays(TODAY, 30);
    if (dateRange === '90d') return subtractDays(TODAY, 90);
    return customFrom;
  }, [dateRange, customFrom]);

  const toDate = dateRange === 'custom' ? customTo : TODAY_STR;

  // Team member IDs for scoping
  const teamMemberIds = useMemo(() => new Set(activeUsers.map((u) => u.id)), [activeUsers]);

  // Scoped activities — owner OR internal participant counts as "participating"
  const filteredActivities = useMemo(() => {
    const includesUser = (a: typeof allActivities[number], uid: string) => a.ownerId === uid || (a.internalParticipants || []).includes(uid);
    const includesAnyOf = (a: typeof allActivities[number], ids: Set<string>) =>
      ids.has(a.ownerId) || (a.internalParticipants || []).some((id) => ids.has(id));

    let acts = [...allActivities];
    // Team scoping
    if (teamFilter !== 'all') acts = acts.filter((a) => includesAnyOf(a, teamMemberIds));
    // Role scoping
    else if (!canViewAll) acts = acts.filter((a) => includesUser(a, userId));
    // Date filter
    if (fromDate) acts = acts.filter((a) => a.date >= fromDate);
    acts = acts.filter((a) => a.date <= toDate);
    // User filter (admin/ceo/coo only) — selected user as owner OR participant
    if (canViewAll && selectedUserId !== 'all') acts = acts.filter((a) => includesUser(a, selectedUserId));
    // Activity type filter
    if (activityTypeFilter !== 'all') acts = acts.filter((a) => a.type === activityTypeFilter);
    return acts.sort((a, b) => b.date.localeCompare(a.date));
  }, [allActivities, canViewAll, userId, fromDate, toDate, selectedUserId, activityTypeFilter, teamFilter, teamMemberIds]);

  function getUserName(id: string): string {
    return allUsers.find((u) => u.id === id)?.name ?? '—';
  }
  function getAccountName(id: string): string {
    return accounts.find((a) => a.id === id)?.name ?? '—';
  }
  function getContactName(id?: string): string {
    if (!id) return '—';
    const c = contacts.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : '—';
  }

  // Summary counts
  const totalActivities = filteredActivities.length;
  const callCount = filteredActivities.filter((a) => a.type === 'Call').length;
  const meetingCount = filteredActivities.filter((a) => a.type === 'Meeting').length;
  const emailCount = filteredActivities.filter((a) => a.type === 'Email').length;

  // Activity by user
  const userActivityStats = useMemo(() => {
    const usersToShow = canViewAll
      ? activeUsers
      : activeUsers.filter((u) => u.id === userId);
    return usersToShow.map((u) => {
      const userActs = filteredActivities.filter((a) => a.ownerId === u.id);
      const calls = userActs.filter((a) => a.type === 'Call').length;
      const meetings = userActs.filter((a) => a.type === 'Meeting').length;
      const emails = userActs.filter((a) => a.type === 'Email').length;
      const notes = userActs.filter((a) => a.type === 'Note').length;
      const total = userActs.length;
      const lastActive = userActs.length > 0 ? userActs[0].date : null;
      const recentActs = userActs.slice(0, 5);
      return { user: u, calls, meetings, emails, notes, total, lastActive, recentActs };
    });
  }, [canViewAll, activeUsers, userId, filteredActivities]);

  // Team stats
  const TEAMS: { key: UserTeam; label: string; color: string }[] = [
    { key: 'monogastrics', label: 'Monogastrics', color: '#3b82f6' },
    { key: 'ruminants', label: 'Ruminants', color: '#22c55e' },
    { key: 'latam', label: 'LATAM', color: '#f59e0b' },
    { key: 'familyb2b', label: 'Family / B2B', color: '#8b5cf6' },
    { key: 'marketing', label: 'Marketing', color: '#993556' },
    { key: 'management', label: 'Management', color: '#6b7280' },
  ];

  const teamStats = useMemo(() => {
    return TEAMS.map(({ key, label, color }) => {
      // Monogastrics includes swine sub-team
      const teamUsers = key === 'monogastrics'
        ? activeUsers.filter((u) => MONO_GROUP.includes((u as { team?: string }).team ?? ''))
        : activeUsers.filter((u) => ((u as { team?: string }).team ?? '') === key);
      const teamIds = new Set(teamUsers.map((u) => u.id));
      const teamActs = filteredActivities.filter((a) => teamIds.has(a.ownerId));
      const teamTasks = allTasks.filter((t) => teamIds.has(t.ownerId));
      const teamOpps = allOpps.filter((o) => teamIds.has(o.ownerId));
      const openPipeline = teamOpps.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').reduce((s, o) => s + (o.amount || 0), 0);
      const calls = teamActs.filter((a) => a.type === 'Call').length;
      const meetings = teamActs.filter((a) => a.type === 'Meeting').length;
      const emails = teamActs.filter((a) => a.type === 'Email').length;
      const notes = teamActs.filter((a) => a.type === 'Note').length;
      const total = teamActs.length;
      return { key, label, color, members: teamUsers.length, calls, meetings, emails, notes, total, taskCount: teamTasks.length, oppCount: teamOpps.length, openPipeline, teamUsers };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUsers, filteredActivities]);

  // Build team summaries — split monogastrics into poultry + swine
  const teamSummariesForReport = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, { teamName: string; activities: any[]; tasks: any[]; opportunities: any[] }> = {};
    const teams = [
      { id: 'poultry', teamFilter: 'monogastrics', label: 'Poultry' },
      { id: 'swine', teamFilter: 'swine', label: 'Swine' },
      { id: 'ruminants', teamFilter: 'ruminants', label: 'Ruminant' },
      { id: 'latam', teamFilter: 'latam', label: 'LATAM' },
      { id: 'marketing', teamFilter: 'marketing', label: 'Marketing' },
      { id: 'management', teamFilter: 'management', label: 'Management' },
    ];

    // Enrich raw records with resolved names so the API/AI doesn't have to
    // guess from raw UUIDs.
    const enrichActivity = (a: typeof allActivities[number]) => ({
      ...a,
      ownerName: getUserName(a.ownerId),
      accountName: a.accountId ? getAccountName(a.accountId) : '',
      contactName: a.contactId ? getContactName(a.contactId) : '',
    });
    const enrichTask = (t: typeof allTasks[number]) => ({
      ...t,
      ownerName: getUserName(t.ownerId),
      accountName: t.relatedAccountId ? getAccountName(t.relatedAccountId) : '',
    });
    const enrichOpp = (o: typeof allOpps[number]) => ({
      ...o,
      ownerName: getUserName(o.ownerId),
      accountName: o.accountId ? getAccountName(o.accountId) : '',
    });

    teams.forEach(({ id, teamFilter, label }) => {
      const members = activeUsers.filter((u) => {
        const uTeam = (u as { team?: string }).team;
        if (id === 'management') return uTeam === 'management' || (!uTeam && ['admin', 'administrative_manager', 'ceo'].includes(u.role));
        return uTeam === teamFilter;
      });
      const memberIds = new Set(members.map((u) => u.id));
      result[id] = {
        teamName: label,
        // Apply the same date range filter as Activity Details so the AI report
        // only sees activities/tasks within the selected window (fromDate ~ toDate).
        activities: allActivities
          .filter((a) => memberIds.has(a.ownerId))
          .filter((a) => (!fromDate || a.date >= fromDate) && a.date <= toDate)
          .map(enrichActivity),
        tasks: allTasks
          .filter((t) => memberIds.has(t.ownerId) && t.status !== 'Completed')
          .filter((t) => !t.dueDate || ((!fromDate || t.dueDate >= fromDate) && t.dueDate <= toDate))
          .map(enrichTask),
        opportunities: allOpps
          .filter((o) => memberIds.has(o.ownerId) && o.stage !== 'Closed Lost')
          .map(enrichOpp),
      };
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allActivities, allTasks, allOpps, activeUsers, accounts, contacts, allUsers, fromDate, toDate]);

  async function handleAISummary() {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/ai/generate-weekly-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamSummaries: teamSummariesForReport, reportType: teamFilter }),
      });
      if (!res.ok) throw new Error('Failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      const teamName = teamFilter === 'all' ? 'CEO' : teamFilter.charAt(0).toUpperCase() + teamFilter.slice(1);
      a.download = `PI_USA_${teamName}_Report_${new Date().toISOString().split('T')[0]}.docx`;
      a.click(); URL.revokeObjectURL(url);
    } catch (err) { console.error(err); alert('Failed to generate report.'); }
    finally { setIsGenerating(false); }
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{reportTitle}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{reportSubtitle}</p>
            </div>
            <div className="flex items-center gap-3">
              {/* View toggle — Sales Director sees individual breakdown only */}
              {canViewAll && !isSalesDirector && (
                <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                  <button onClick={() => setViewMode('individual')}
                    className={`px-3 py-1 text-xs font-medium rounded transition-all ${viewMode === 'individual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                    By Individual
                  </button>
                  <button onClick={() => setViewMode('team')}
                    className={`px-3 py-1 text-xs font-medium rounded transition-all ${viewMode === 'team' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                    By Team
                  </button>
                </div>
              )}
              <button
                onClick={handleAISummary}
                disabled={isGenerating}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all"
                style={{ backgroundColor: isGenerating ? '#e5e7eb' : '#1a4731', color: isGenerating ? '#888' : 'white', cursor: isGenerating ? 'not-allowed' : 'pointer' }}
              >
                {isGenerating ? '⏳ Generating...' : '✨ AI Weekly Report'}
              </button>
            </div>
          </div>

          {/* Filter bar */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-6 flex flex-wrap items-center gap-3">
            {/* Date range */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              {(['7d', '30d', '90d', 'custom'] as DateRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setDateRange(r)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    dateRange === r ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : r === '90d' ? 'Last 90 days' : 'Custom'}
                </button>
              ))}
            </div>

            {dateRange === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            )}

            {/* User filter (admin/ceo/coo only) */}
            {canViewAll && (
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="all">All Users</option>
                {activeUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            )}

            {/* Activity type filter */}
            <select
              value={activityTypeFilter}
              onChange={(e) => setActivityTypeFilter(e.target.value as ActivityFilter)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="all">All Types</option>
              <option value="Call">Calls</option>
              <option value="Meeting">Meetings</option>
              <option value="Email">Emails</option>
              <option value="Note">Notes</option>
            </select>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Activities', value: totalActivities, color: 'text-gray-900' },
              { label: 'Calls Logged', value: callCount, color: 'text-blue-700' },
              { label: 'Meetings Held', value: meetingCount, color: 'text-purple-700' },
              { label: 'Emails Sent', value: emailCount, color: 'text-green-700' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
                <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {viewMode === 'individual' ? (<>
          {/* Section A: Activity by User */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Activity by User</h2>
              <p className="text-xs text-gray-500 mt-0.5">Click a row to see recent activities</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">User</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Calls</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Meetings</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Emails</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Notes</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Total</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {userActivityStats.map(({ user, calls, meetings, emails, notes, total, lastActive, recentActs }) => (
                  <React.Fragment key={user.id}>
                    <tr
                      onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
                      className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 overflow-hidden"
                            style={{ backgroundColor: user.profilePhoto ? 'transparent' : '#1a4731' }}
                          >
                            {user.profilePhoto ? (
                              <img src={user.profilePhoto} alt={user.name} className="w-8 h-8 object-cover" />
                            ) : (
                              user.initials
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{user.name}</p>
                            <p className="text-xs text-gray-400">{getRoleLabel(user.role)}</p>
                          </div>
                          <svg
                            className={`w-4 h-4 text-gray-400 ml-1 transition-transform ${expandedUser === user.id ? 'rotate-180' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right font-medium text-blue-700">{calls}</td>
                      <td className="px-5 py-4 text-right font-medium text-purple-700">{meetings}</td>
                      <td className="px-5 py-4 text-right font-medium text-green-700">{emails}</td>
                      <td className="px-5 py-4 text-right text-gray-500">{notes}</td>
                      <td className="px-5 py-4 text-right font-semibold text-gray-900">{total}</td>
                      <td className="px-5 py-4 text-gray-500">{lastActive ? formatDate(lastActive) : '—'}</td>
                    </tr>
                    {expandedUser === user.id && (
                      <tr key={`${user.id}-expand`} className="border-b border-gray-100 bg-gray-50/50">
                        <td colSpan={7} className="px-8 py-3">
                          {recentActs.length === 0 ? (
                            <p className="text-xs text-gray-400 py-1">No activities in this period.</p>
                          ) : (
                            <div className="space-y-2">
                              {recentActs.map((a) => (
                                <div key={a.id} className="flex items-start gap-3 text-xs">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${typeBg[a.type]}`}>
                                    {typeIcon[a.type]} {a.type}
                                  </span>
                                  <span className="text-gray-400 w-20 flex-shrink-0">{formatDate(a.date)}</span>
                                  <span className="font-medium text-gray-700">{a.subject}</span>
                                  <span className="text-gray-400">{getAccountName(a.accountId)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {userActivityStats.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">
                      No activity data for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Section B: Activity Details */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Activity Details</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{filteredActivities.length} activities — click a row to expand</p>
                </div>
              </div>
              {/* Per-user filter chips (admin tier only) */}
              {canViewAll && (() => {
                // Compute activity count per active user, ignoring the user filter itself
                const baseActs = (() => {
                  let acts = [...allActivities];
                  if (teamFilter !== 'all') acts = acts.filter((a) => teamMemberIds.has(a.ownerId));
                  if (fromDate) acts = acts.filter((a) => a.date >= fromDate);
                  acts = acts.filter((a) => a.date <= toDate);
                  if (activityTypeFilter !== 'all') acts = acts.filter((a) => a.type === activityTypeFilter);
                  return acts;
                })();
                const totalCount = baseActs.length;
                const usersWithCounts = activeUsers
                  .map((u) => ({ u, count: baseActs.filter((a) => a.ownerId === u.id || (a.internalParticipants || []).includes(u.id)).length }))
                  .filter((x) => x.count > 0)
                  .sort((a, b) => b.count - a.count);
                if (usersWithCounts.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    <button onClick={() => setSelectedUserId('all')}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${selectedUserId === 'all' ? 'border-transparent text-white font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
                      style={selectedUserId === 'all' ? { backgroundColor: '#1a4731' } : {}}>
                      All <span className={`ml-1 ${selectedUserId === 'all' ? 'opacity-80' : 'text-gray-400'}`}>({totalCount})</span>
                    </button>
                    {usersWithCounts.map(({ u, count }) => {
                      const active = selectedUserId === u.id;
                      const initials = u.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
                      return (
                        <button key={u.id} onClick={() => setSelectedUserId(active ? 'all' : u.id)}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-full border transition-colors ${active ? 'border-transparent text-white font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
                          style={active ? { backgroundColor: '#1a4731' } : {}}>
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-semibold flex-shrink-0 ${active ? 'bg-white/20 text-white' : 'text-white'}`}
                            style={!active ? { backgroundColor: '#1a4731' } : {}}>
                            {initials}
                          </span>
                          {u.name}
                          <span className={active ? 'opacity-80' : 'text-gray-400'}>({count})</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div className="divide-y divide-gray-50">
              {filteredActivities.length === 0 && (
                <div className="px-6 py-8 text-center text-sm text-gray-400">
                  No activities match your filters.
                </div>
              )}
              {filteredActivities.map((activity) => (
                <div key={activity.id}>
                  <button
                    onClick={() => setExpandedRow(expandedRow === activity.id ? null : activity.id)}
                    className="w-full text-left px-6 py-4 hover:bg-gray-50/60 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${typeBg[activity.type]}`}>
                        {typeIcon[activity.type]} {activity.type}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-medium text-gray-900 text-sm">{activity.subject}</span>
                          {activity.internalParticipants && activity.internalParticipants.length > 0 && (
                            <span className="inline-flex items-center gap-1" title={`Internal participants: ${activity.internalParticipants.map((id) => getUserName(id)).join(', ')}`}>
                              {activity.internalParticipants.slice(0, 3).map((id, i) => {
                                const initials = (allUsers.find((u) => u.id === id)?.name || '?').split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
                                return (
                                  <span key={id} className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold text-white border-2 border-white" style={{ backgroundColor: '#1e40af', marginLeft: i > 0 ? '-8px' : 0, zIndex: 3 - i }}>
                                    {initials}
                                  </span>
                                );
                              })}
                              {activity.internalParticipants.length > 3 && (
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-semibold text-blue-700 bg-blue-100 border-2 border-white" style={{ marginLeft: '-8px' }}>
                                  +{activity.internalParticipants.length - 3}
                                </span>
                              )}
                              <span className="text-[10px] text-blue-700 ml-1 font-medium">joint</span>
                            </span>
                          )}
                          <span className="text-xs text-gray-400">{formatDate(activity.date)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 flex-wrap">
                          <span>{getUserName(activity.ownerId)}</span>
                          {activity.internalParticipants && activity.internalParticipants.length > 0 && (
                            <>
                              <span className="text-gray-300">+</span>
                              <span className="text-blue-700">{activity.internalParticipants.map((id) => getUserName(id)).join(', ')}</span>
                            </>
                          )}
                          {activity.accountId && (
                            <>
                              <span className="text-gray-300">·</span>
                              <span>{getAccountName(activity.accountId)}</span>
                            </>
                          )}
                          {activity.contactId && (
                            <>
                              <span className="text-gray-300">·</span>
                              <span>{getContactName(activity.contactId)}</span>
                            </>
                          )}
                        </div>
                        {activity.description && expandedRow !== activity.id && (
                          <p className="text-xs text-gray-400 mt-1 truncate max-w-lg">{activity.description}</p>
                        )}
                      </div>
                      <svg
                        className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expandedRow === activity.id ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  {expandedRow === activity.id && activity.description && (
                    <div className="px-6 pb-4 pl-16">
                      <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-3">{activity.description}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Section C: Task Details */}
          {(() => {
            // Build base task list (apply same scoping as activities, except using dueDate)
            const baseTasks = (() => {
              let ts = [...allTasks];
              if (teamFilter !== 'all') ts = ts.filter((t) => teamMemberIds.has(t.ownerId));
              else if (!canViewAll) ts = ts.filter((t) => t.ownerId === userId);
              if (fromDate) ts = ts.filter((t) => !t.dueDate || t.dueDate >= fromDate);
              ts = ts.filter((t) => !t.dueDate || t.dueDate <= toDate);
              return ts;
            })();
            const filteredTasks = baseTasks
              .filter((t) => canViewAll && selectedUserId !== 'all' ? t.ownerId === selectedUserId : true)
              .sort((a, b) => {
                // Overdue open tasks first, then by due date asc
                const aOverdue = a.status === 'Open' && a.dueDate && a.dueDate < TODAY_STR ? 1 : 0;
                const bOverdue = b.status === 'Open' && b.dueDate && b.dueDate < TODAY_STR ? 1 : 0;
                if (aOverdue !== bOverdue) return bOverdue - aOverdue;
                return (a.dueDate || '').localeCompare(b.dueDate || '');
              });
            const overdueCount = filteredTasks.filter((t) => t.status === 'Open' && t.dueDate && t.dueDate < TODAY_STR).length;
            const openCount = filteredTasks.filter((t) => t.status === 'Open').length;
            const completedCount = filteredTasks.filter((t) => t.status === 'Completed').length;

            return (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mt-6">
                <div className="px-6 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Task Details</h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''} · <span className="text-gray-400">Open: {openCount}</span> · <span className="text-gray-400">Completed: {completedCount}</span>
                        {overdueCount > 0 && <> · <span className="text-red-600 font-medium">⚠ {overdueCount} overdue</span></>}
                      </p>
                    </div>
                  </div>
                  {/* Per-user filter chips (admin tier only) — reuses Activity Details selectedUserId */}
                  {canViewAll && (() => {
                    const usersWithCounts = activeUsers
                      .map((u) => ({ u, count: baseTasks.filter((t) => t.ownerId === u.id).length, overdue: baseTasks.filter((t) => t.ownerId === u.id && t.status === 'Open' && t.dueDate && t.dueDate < TODAY_STR).length }))
                      .filter((x) => x.count > 0)
                      .sort((a, b) => b.overdue - a.overdue || b.count - a.count);
                    if (usersWithCounts.length === 0) return null;
                    return (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        <button onClick={() => setSelectedUserId('all')}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${selectedUserId === 'all' ? 'border-transparent text-white font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
                          style={selectedUserId === 'all' ? { backgroundColor: '#1a4731' } : {}}>
                          All <span className={`ml-1 ${selectedUserId === 'all' ? 'opacity-80' : 'text-gray-400'}`}>({baseTasks.length})</span>
                        </button>
                        {usersWithCounts.map(({ u, count, overdue }) => {
                          const active = selectedUserId === u.id;
                          const initials = u.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
                          return (
                            <button key={u.id} onClick={() => setSelectedUserId(active ? 'all' : u.id)}
                              className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-full border transition-colors ${active ? 'border-transparent text-white font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
                              style={active ? { backgroundColor: '#1a4731' } : {}}>
                              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-semibold flex-shrink-0 ${active ? 'bg-white/20 text-white' : 'text-white'}`}
                                style={!active ? { backgroundColor: '#1a4731' } : {}}>
                                {initials}
                              </span>
                              {u.name}
                              <span className={active ? 'opacity-80' : 'text-gray-400'}>({count})</span>
                              {overdue > 0 && (
                                <span className={`text-[9px] px-1 rounded font-bold ${active ? 'bg-white/30 text-white' : 'bg-red-100 text-red-700'}`}>!{overdue}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                <div className="divide-y divide-gray-50">
                  {filteredTasks.length === 0 && (
                    <div className="px-6 py-8 text-center text-sm text-gray-400">No tasks match your filters.</div>
                  )}
                  {filteredTasks.slice(0, 200).map((task) => {
                    const isOverdue = task.status === 'Open' && task.dueDate && task.dueDate < TODAY_STR;
                    const isDueToday = task.status === 'Open' && task.dueDate === TODAY_STR;
                    const priorityColor = task.priority === 'High' ? 'bg-red-50 text-red-700' : task.priority === 'Medium' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600';
                    return (
                      <div key={task.id} className={`px-6 py-3 hover:bg-gray-50/60 transition-colors ${isOverdue ? 'bg-red-50/20' : ''}`}>
                        <div className="flex items-start gap-3">
                          {/* Status indicator */}
                          <span className={`flex-shrink-0 mt-1 w-2.5 h-2.5 rounded-full ${task.status === 'Completed' ? 'bg-green-500' : isOverdue ? 'bg-red-500' : isDueToday ? 'bg-amber-500' : 'bg-gray-300'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm ${task.status === 'Completed' ? 'text-gray-500 line-through' : 'font-medium text-gray-900'}`}>{task.subject}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${priorityColor}`}>{task.priority}</span>
                              {isOverdue && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-600 text-white">OVERDUE</span>
                              )}
                              {isDueToday && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-800">DUE TODAY</span>
                              )}
                              {task.status === 'Completed' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-100 text-green-700">✓ DONE</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 flex-wrap">
                              <span>{getUserName(task.ownerId)}</span>
                              {task.dueDate && (
                                <>
                                  <span className="text-gray-300">·</span>
                                  <span className={isOverdue ? 'text-red-600 font-medium' : ''}>Due {formatDate(task.dueDate)}</span>
                                </>
                              )}
                              {task.relatedAccountId && (
                                <>
                                  <span className="text-gray-300">·</span>
                                  <span>{getAccountName(task.relatedAccountId)}</span>
                                </>
                              )}
                              {task.relatedContactId && (
                                <>
                                  <span className="text-gray-300">·</span>
                                  <span>{getContactName(task.relatedContactId)}</span>
                                </>
                              )}
                            </div>
                            {task.description && (
                              <p className="text-xs text-gray-400 mt-1 line-clamp-1">{task.description}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {filteredTasks.length > 200 && (
                    <div className="px-6 py-3 text-center text-xs text-gray-400">Showing first 200 of {filteredTasks.length} tasks</div>
                  )}
                </div>
              </div>
            );
          })()}
          </>) : (
          <>
          {/* Team View — Expandable */}
          <div className="space-y-2 mb-6">
            {teamStats.map((t) => {
              const isTeamOpen = expandedTeams.has(t.key ?? '');
              return (
                <div key={t.key} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  {/* Team header */}
                  <div onClick={() => toggleTeam(t.key ?? '')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && toggleTeam(t.key ?? '')}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors cursor-pointer">
                    <span className="text-gray-400">{isTeamOpen ? '▼' : '▶'}</span>
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                    <span className="font-semibold text-gray-900 min-w-[120px]">{t.label}</span>
                    <span className="text-xs text-gray-500">{t.members} members</span>
                    <span className="text-xs ml-4 text-gray-600">Activities: {t.total}</span>
                    <span className="text-xs ml-3 text-gray-600">Tasks: {t.taskCount}</span>
                    <span className="text-xs ml-3 text-gray-600">Opps: {t.oppCount}</span>
                    <span className="text-xs ml-3 font-medium" style={{ color: '#1a4731' }}>Pipeline: ${(t.openPipeline / 1000).toFixed(0)}K</span>
                  </div>

                  {/* Members */}
                  {isTeamOpen && (
                    <div className="border-t border-gray-100">
                      {t.teamUsers.map((u) => {
                        const uActs = filteredActivities.filter((a) => a.ownerId === u.id);
                        const uTasks = allTasks.filter((tk) => tk.ownerId === u.id);
                        const uOpps = allOpps.filter((o) => o.ownerId === u.id);
                        const uPipeline = uOpps.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').reduce((s, o) => s + (o.amount || 0), 0);
                        const uOverdue = uTasks.filter((tk) => tk.status === 'Open' && tk.dueDate < TODAY_STR).length;
                        const isMemberOpen = expandedMembers.has(u.id);
                        const detailTab = memberDetailTab[u.id] || 'activities';

                        return (
                          <div key={u.id}>
                            <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 pl-10 border-b border-gray-50 hover:bg-gray-50/50">
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0" style={{ backgroundColor: '#1a4731' }}>
                                {u.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                              </div>
                              <span className="text-sm font-medium text-gray-800 min-w-[110px]">{u.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600">{getRoleLabel(u.role)}</span>
                              <span className="text-xs text-gray-500 ml-2">Acts: {uActs.length}</span>
                              <span className="text-xs text-gray-500">Tasks: {uTasks.filter((tk) => tk.status === 'Open').length}{uOverdue > 0 ? ` (${uOverdue} overdue)` : ''}</span>
                              <span className="text-xs text-gray-500">Opps: {uOpps.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').length} · ${(uPipeline / 1000).toFixed(0)}K</span>
                              <button onClick={() => toggleMember(u.id)} className="ml-auto text-xs px-3 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                                {isMemberOpen ? '▲ Hide' : '▶ Details'}
                              </button>
                            </div>

                            {isMemberOpen && (
                              <div className="pl-10 pr-5 py-2 bg-gray-50/30">
                                {/* Detail tabs */}
                                <div className="flex gap-1 mb-3 bg-gray-100 p-1 rounded-lg w-fit">
                                  {(['activities', 'tasks', 'opportunities'] as const).map((tab) => (
                                    <button key={tab} onClick={() => setMemberDetailTab((p) => ({ ...p, [u.id]: tab }))}
                                      className={`px-3 py-1 text-xs font-medium rounded transition-all ${detailTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                                      {tab === 'activities' ? `Activities (${uActs.length})` : tab === 'tasks' ? `Tasks (${uTasks.length})` : `Opportunities (${uOpps.length})`}
                                    </button>
                                  ))}
                                </div>

                                {/* Activities tab */}
                                {detailTab === 'activities' && (
                                  <div className="space-y-1.5">
                                    {uActs.length === 0 ? <p className="text-sm text-gray-400 py-2">No activities.</p>
                                    : uActs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((act) => (
                                      <div key={act.id} className="flex gap-3 p-3 bg-white rounded-lg border border-gray-100">
                                        <span className="text-lg flex-shrink-0">{act.type === 'Call' ? '📞' : act.type === 'Meeting' ? '🤝' : act.type === 'Email' ? '📧' : '📝'}</span>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm font-medium text-gray-800">{act.subject}</span>
                                            <span className="text-[11px] text-gray-400 ml-auto">{formatDate(act.date)}</span>
                                          </div>
                                          {(getAccountName(act.accountId) || getContactName(act.contactId)) && (
                                            <div className="text-xs text-gray-500 mb-1">
                                              {getAccountName(act.accountId) && <span>📁 {getAccountName(act.accountId)}</span>}
                                              {getContactName(act.contactId) && <span className="ml-3">👤 {getContactName(act.contactId)}</span>}
                                            </div>
                                          )}
                                          {act.description && <p className="text-xs text-gray-600 bg-gray-50 rounded px-2.5 py-1.5 mt-1 line-clamp-3">{act.description}</p>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Tasks tab */}
                                {detailTab === 'tasks' && (
                                  <div className="overflow-x-auto">
                                    {uTasks.length === 0 ? <p className="text-sm text-gray-400 py-2">No tasks.</p> : (
                                      <table className="w-full text-xs">
                                        <thead><tr className="border-b border-gray-200">
                                          <th className="text-left p-2 text-gray-500 font-medium">Subject</th>
                                          <th className="text-left p-2 text-gray-500 font-medium">Account</th>
                                          <th className="text-left p-2 text-gray-500 font-medium">Due Date</th>
                                          <th className="text-left p-2 text-gray-500 font-medium">Priority</th>
                                          <th className="text-left p-2 text-gray-500 font-medium">Status</th>
                                        </tr></thead>
                                        <tbody>
                                          {uTasks.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).map((tk) => {
                                            const isOverdue = tk.status === 'Open' && tk.dueDate < TODAY_STR;
                                            const isDueToday = tk.status === 'Open' && tk.dueDate === TODAY_STR;
                                            return (
                                              <tr key={tk.id} className="border-b border-gray-50">
                                                <td className="p-2 font-medium text-gray-800">{tk.subject}</td>
                                                <td className="p-2 text-gray-500">{accounts.find((a) => a.id === tk.relatedAccountId)?.name || '—'}</td>
                                                <td className={`p-2 ${isOverdue ? 'text-red-600 font-medium' : isDueToday ? 'text-amber-600' : 'text-gray-500'}`}>
                                                  {tk.dueDate ? formatDate(tk.dueDate) : '—'}{isOverdue && ' (overdue)'}{isDueToday && ' (today)'}
                                                </td>
                                                <td className="p-2">
                                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tk.priority === 'High' ? 'bg-red-100 text-red-700' : tk.priority === 'Medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{tk.priority}</span>
                                                </td>
                                                <td className="p-2">
                                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tk.status === 'Completed' ? 'bg-green-100 text-green-700' : isOverdue ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-600'}`}>
                                                    {tk.status === 'Completed' ? 'Done' : isOverdue ? 'Overdue' : isDueToday ? 'Today' : 'Open'}
                                                  </span>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                )}

                                {/* Opportunities tab */}
                                {detailTab === 'opportunities' && (
                                  <div className="overflow-x-auto">
                                    {uOpps.length === 0 ? <p className="text-sm text-gray-400 py-2">No opportunities.</p> : (
                                      <table className="w-full text-xs">
                                        <thead><tr className="border-b border-gray-200">
                                          <th className="text-left p-2 text-gray-500 font-medium">Opportunity</th>
                                          <th className="text-left p-2 text-gray-500 font-medium">Account</th>
                                          <th className="text-left p-2 text-gray-500 font-medium">Stage</th>
                                          <th className="text-right p-2 text-gray-500 font-medium">Amount</th>
                                          <th className="text-left p-2 text-gray-500 font-medium">Close Date</th>
                                        </tr></thead>
                                        <tbody>
                                          {uOpps.sort((a, b) => (a.closeDate || '').localeCompare(b.closeDate || '')).map((op) => (
                                            <tr key={op.id} className="border-b border-gray-50">
                                              <td className="p-2 font-medium"><a href={`/opportunities/${op.id}`} className="hover:underline" style={{ color: '#1a4731' }}>{op.name}</a></td>
                                              <td className="p-2 text-gray-500">{accounts.find((a) => a.id === op.accountId)?.name || '—'}</td>
                                              <td className="p-2">
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                  op.stage === 'Closed Won' ? 'bg-green-100 text-green-700' : op.stage === 'Closed Lost' ? 'bg-gray-100 text-gray-500' :
                                                  op.stage === 'Negotiation' ? 'bg-purple-100 text-purple-700' : op.stage === 'Proposal' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                                                }`}>{op.stage}</span>
                                              </td>
                                              <td className="p-2 text-right font-medium">${(op.amount || 0).toLocaleString()}</td>
                                              <td className="p-2 text-gray-500">{op.closeDate ? formatDate(op.closeDate) : '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                        <tfoot><tr className="border-t border-gray-200 bg-gray-50">
                                          <td colSpan={3} className="p-2 text-gray-600 font-medium">Open Pipeline</td>
                                          <td className="p-2 text-right font-semibold" style={{ color: '#1a4731' }}>${uPipeline.toLocaleString()}</td>
                                          <td></td>
                                        </tr></tfoot>
                                      </table>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Team comparison chart */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Team Comparison</h2>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamStats} layout="vertical" margin={{ left: 10, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="total" name="Total Activities" radius={[0, 4, 4, 0]}>
                    {teamStats.map((t, i) => (
                      <rect key={i} fill={t.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          </>
          )}
        </div>
      </main>
    </div>
  );
}
