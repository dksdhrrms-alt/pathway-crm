'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ActivityType, Stage } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import MetricCard from '@/app/components/MetricCard';
import TopBar from '@/app/components/TopBar';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import Toast from '@/app/components/Toast';
import QuickLogModal from '@/app/components/QuickLogModal';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';

const TODAY = new Date().toISOString().split('T')[0];
const CURRENT_MONTH = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();

const typeIcon: Record<ActivityType, string> = {
  Call: '📞', Meeting: '🤝', Email: '📧', Note: '📝',
};

const stageColors: Record<string, string> = {
  Prospecting: '#6366f1',
  Qualification: '#f59e0b',
  Proposal: '#3b82f6',
  Negotiation: '#f97316',
  'Closed Won': '#22c55e',
  'Closed Lost': '#ef4444',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function formatCompact(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const userId = session?.user?.id ?? '';
  const userName = session?.user?.name ?? '';
  const isAdminCeo = ['administrative_manager', 'admin', 'ceo'].includes(role);

  const { opportunities: allOpps, tasks: allTasks, activities: allActivities, accounts, contacts, toggleTask, loading } = useCRM();
  const { users } = useUsers();

  const [activeTab, setActiveTab] = useState<'company' | 'team' | 'personal'>(isAdminCeo ? 'company' : 'team');
  const [toast, setToast] = useState<string | null>(null);
  const [quotaTarget, setQuotaTarget] = useState(500000);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [quotaInput, setQuotaInput] = useState('500000');
  const [quickLogType, setQuickLogType] = useState<ActivityType | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('quota_target');
      if (saved) { setQuotaTarget(parseInt(saved)); setQuotaInput(saved); }
    } catch { /* ignore */ }
  }, []);

  // Team info
  const currentUser = users.find((u) => u.id === userId || u.name === userName);
  const currentTeam = (currentUser as { team?: string })?.team ?? '';
  const dashboardTeam = currentTeam === 'swine' ? 'monogastrics' : currentTeam;
  const MONO_GROUP = ['monogastrics', 'swine'];
  const teamLabel = dashboardTeam ? ({ monogastrics: 'Monogastrics', ruminants: 'Ruminants', latam: 'LATAM', familyb2b: 'Family / B2B', marketing: 'Marketing', management: 'Management' }[dashboardTeam] || dashboardTeam) : 'Team';
  const teamMembers = useMemo(() => {
    if (!dashboardTeam) return [];
    if (dashboardTeam === 'monogastrics') return users.filter((u) => MONO_GROUP.includes((u as { team?: string }).team || ''));
    return users.filter((u) => (u as { team?: string }).team === dashboardTeam);
  }, [users, dashboardTeam]);
  const teamMemberIds = useMemo(() => new Set(teamMembers.map((u) => u.id)), [teamMembers]);

  // Scoped data based on active tab
  const opportunities = useMemo(() => {
    if (activeTab === 'company') return allOpps;
    if (activeTab === 'team') return allOpps.filter((o) => teamMemberIds.has(o.ownerId));
    return allOpps.filter((o) => o.ownerId === userId);
  }, [allOpps, activeTab, teamMemberIds, userId]);

  const scopedTasks = useMemo(() => {
    if (activeTab === 'company') return allTasks;
    if (activeTab === 'team') return allTasks.filter((t) => teamMemberIds.has(t.ownerId));
    return allTasks.filter((t) => t.ownerId === userId);
  }, [allTasks, activeTab, teamMemberIds, userId]);

  const scopedActivities = useMemo(() => {
    if (activeTab === 'company') return allActivities;
    if (activeTab === 'team') return allActivities.filter((a) => teamMemberIds.has(a.ownerId));
    return allActivities.filter((a) => a.ownerId === userId);
  }, [allActivities, activeTab, teamMemberIds, userId]);

  const openOpps = opportunities.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost');
  const pipelineValue = openOpps.reduce((sum, o) => sum + o.amount, 0);
  const dueTodayCount = scopedTasks.filter((t) => t.dueDate === TODAY && t.status === 'Open').length;
  const overdueCount = scopedTasks.filter((t) => t.dueDate < TODAY && t.status === 'Open').length;

  const taskList = scopedTasks.filter((t) => t.status === 'Open').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const recentActivities = [...scopedActivities].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10);

  // Charts
  const pipelineByStage = useMemo(() => {
    const stages: Stage[] = ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won'];
    return stages.map((stage) => ({
      stage, amount: opportunities.filter((o) => o.stage === stage).reduce((s, o) => s + o.amount, 0), fill: stageColors[stage],
    }));
  }, [opportunities]);

  const activityTrend = useMemo(() => {
    const now = new Date();
    const months: string[] = [];
    const labels: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      labels.push(d.toLocaleString('en-US', { month: 'short' }));
    }
    return months.map((m, i) => ({
      month: labels[i],
      Calls: scopedActivities.filter((a) => a.date?.startsWith(m) && a.type === 'Call').length,
      Meetings: scopedActivities.filter((a) => a.date?.startsWith(m) && a.type === 'Meeting').length,
    }));
  }, [scopedActivities]);

  // ── Activity Leaderboard ────────────────────────────────────────────────
  const POINTS: Record<string, number> = { Call: 3, Meeting: 5, Email: 2, Note: 1 };
  const leaderboard = useMemo(() => {
    const curPrefix = CURRENT_MONTH;
    const prevDate = new Date(); prevDate.setMonth(prevDate.getMonth() - 1);
    const prevPrefix = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const activeUsersList = users.filter((u) => u.status === 'active');
    return activeUsersList.map((u) => {
      const curActs = allActivities.filter((a) => a.ownerId === u.id && a.date?.startsWith(curPrefix));
      const prevActs = allActivities.filter((a) => a.ownerId === u.id && a.date?.startsWith(prevPrefix));
      const curPts = curActs.reduce((s, a) => s + (POINTS[a.type] || 1), 0);
      const prevPts = prevActs.reduce((s, a) => s + (POINTS[a.type] || 1), 0);
      const calls = curActs.filter((a) => a.type === 'Call').length;
      const meetings = curActs.filter((a) => a.type === 'Meeting').length;
      const emails = curActs.filter((a) => a.type === 'Email').length;
      const notes = curActs.filter((a) => a.type === 'Note').length;
      return { user: u, points: curPts, prevPoints: prevPts, total: curActs.length, calls, meetings, emails, notes };
    }).filter((x) => x.points > 0 || x.prevPoints > 0).sort((a, b) => b.points - a.points);
  }, [allActivities, users]);

  // ── Quota ───────────────────────────────────────────────────────────────
  const wonThisMonth = opportunities.filter((o) => o.stage === 'Closed Won' && o.closeDate?.startsWith(CURRENT_MONTH));
  const lostThisMonth = opportunities.filter((o) => o.stage === 'Closed Lost' && o.closeDate?.startsWith(CURRENT_MONTH));
  const wonAmount = wonThisMonth.reduce((s, o) => s + o.amount, 0);
  const quotaPct = quotaTarget > 0 ? Math.round((wonAmount / quotaTarget) * 100) : 0;
  const quotaColor = quotaPct >= 80 ? '#22c55e' : quotaPct >= 50 ? '#f59e0b' : '#ef4444';
  const winRate = wonThisMonth.length + lostThisMonth.length > 0
    ? Math.round((wonThisMonth.length / (wonThisMonth.length + lostThisMonth.length)) * 100)
    : 0;

  function getAccountName(id?: string) { return id ? (accounts.find((a) => a.id === id)?.name ?? '') : ''; }
  function getContactName(id?: string) { if (!id) return ''; const c = contacts.find((x) => x.id === id); return c ? `${c.firstName} ${c.lastName}` : ''; }

  function saveQuota() {
    const val = parseInt(quotaInput) || 500000;
    setQuotaTarget(val);
    localStorage.setItem('quota_target', String(val));
    setShowQuotaModal(false);
  }

  // Notification counts
  const overdueTaskCount = allTasks.filter(
    (t) => t.ownerId === userId && t.status !== 'Completed' && t.dueDate && new Date(t.dueDate + 'T00:00:00') < new Date(),
  ).length;
  const closingTodayCount = allOpps.filter((o) => {
    if (!o.closeDate || o.stage === 'Closed Won' || o.stage === 'Closed Lost') return false;
    if (o.ownerId !== userId) return false;
    const days = Math.floor((new Date(o.closeDate + 'T00:00:00').getTime() - new Date().getTime()) / 86400000);
    return days >= 0 && days <= 1;
  }).length;

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar placeholder="Search CRM..." />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">

          {/* Urgent alert banner */}
          {(overdueTaskCount > 0 || closingTodayCount > 0) && (
            <div
              style={{
                background: '#FCEBEB', border: '1px solid #F09595',
                borderRadius: '10px', padding: '12px 16px',
                marginTop: '24px', marginBottom: '0',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}
            >
              <span style={{ fontSize: '20px' }}>&#9888;&#65039;</span>
              <div style={{ flex: 1, fontSize: '13px', color: '#A32D2D' }}>
                {overdueTaskCount > 0 && (
                  <span><strong>{overdueTaskCount}</strong> overdue task{overdueTaskCount > 1 ? 's' : ''}</span>
                )}
                {overdueTaskCount > 0 && closingTodayCount > 0 && ' \u00B7 '}
                {closingTodayCount > 0 && (
                  <span><strong>{closingTodayCount}</strong> deal{closingTodayCount > 1 ? 's' : ''} closing today</span>
                )}
              </div>
              <a
                href="/tasks"
                style={{
                  fontSize: '12px', color: '#A32D2D', fontWeight: 500,
                  textDecoration: 'none', padding: '4px 10px',
                  border: '1px solid #F09595', borderRadius: '6px',
                }}
              >
                View &rarr;
              </a>
            </div>
          )}

          <div className="mt-6 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Welcome back, {userName.split(' ')[0]}.
                <span className="ml-2 text-xs font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: '#e8f5e9', color: '#1a4731' }}>
                  {activeTab === 'company' ? 'Company-wide view' : activeTab === 'team' ? `${teamLabel} team view` : 'Personal view'}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Quick Log shortcuts */}
              <div className="flex gap-1.5">
                {(['Call', 'Meeting', 'Email', 'Note'] as ActivityType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setQuickLogType(t)}
                    className="px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs hover:border-gray-300 hover:shadow-sm transition-all flex items-center gap-1"
                  >
                    {t === 'Call' ? '📞' : t === 'Meeting' ? '🤝' : t === 'Email' ? '📧' : '📝'}
                    <span className="hidden sm:inline">{t}</span>
                  </button>
                ))}
              </div>
              {/* View tabs */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                {isAdminCeo && (
                  <button onClick={() => setActiveTab('company')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${activeTab === 'company' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    style={activeTab === 'company' ? { backgroundColor: '#1a4731', color: 'white' } : {}}>
                    Company-wide
                  </button>
                )}
                <button onClick={() => setActiveTab('team')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${activeTab === 'team' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  style={activeTab === 'team' ? { backgroundColor: '#1a4731', color: 'white' } : {}}>
                  {teamLabel || 'Team'}
                </button>
                <button onClick={() => setActiveTab('personal')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${activeTab === 'personal' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  style={activeTab === 'personal' ? { backgroundColor: '#1a4731', color: 'white' } : {}}>
                  Personal
                </button>
              </div>
            </div>
          </div>

          {/* Team members chips */}
          {activeTab === 'team' && teamMembers.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4 items-center">
              <span className="text-xs text-gray-400">Team members:</span>
              {teamMembers.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-700">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-semibold" style={{ backgroundColor: '#1a4731' }}>
                    {m.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                  {m.name}
                  {(m as { team?: string }).team === 'swine' && (
                    <span className="text-[10px] px-1 py-0.5 rounded" style={{ backgroundColor: '#E6F1FB', color: '#185FA5' }}>Swine</span>
                  )}
                </span>
              ))}
            </div>
          )}
          {activeTab === 'team' && !currentTeam && (
            <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: '#FAEEDA', color: '#854F0B' }}>
              You are not assigned to a team yet. Contact your admin to be added to a team.
            </div>
          )}

          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <MetricCard title="Open Opportunities" value={openOpps.length} subtitle="Active pipeline deals" />
            <MetricCard title="Pipeline Value" value={formatCurrency(pipelineValue)} subtitle="Sum of open deal amounts" />
            <MetricCard title="Tasks Due Today" value={dueTodayCount} subtitle={TODAY} />
            <MetricCard title="Overdue Tasks" value={overdueCount} subtitle="Past due, still open" valueClassName={overdueCount > 0 ? 'text-red-600' : ''} />
          </div>

          {/* Quota Achievement */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
            <div className="flex flex-wrap items-center gap-8">
              <div className="flex-shrink-0">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Monthly Quota</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{formatCurrency(wonAmount)}</p>
                <p className="text-sm text-gray-400">Goal: {formatCurrency(quotaTarget)}</p>
              </div>
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold" style={{ color: quotaColor }}>{quotaPct}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3">
                  <div
                    className="h-3 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(quotaPct, 100)}%`, backgroundColor: quotaColor }}
                  />
                </div>
              </div>
              <div className="flex gap-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-600">{wonThisMonth.length}</p>
                  <p className="text-xs text-gray-500">Won This Month</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-red-500">{lostThisMonth.length}</p>
                  <p className="text-xs text-gray-500">Lost This Month</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-gray-800">{winRate}%</p>
                  <p className="text-xs text-gray-500">Win Rate</p>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowQuotaModal(true)}
              className="mt-3 text-xs font-medium hover:underline"
              style={{ color: '#1a4731' }}
            >
              Set Quota Target
            </button>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Pipeline by Stage</h2>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pipelineByStage} layout="vertical" margin={{ left: 10, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={formatCompact} />
                    <YAxis type="category" dataKey="stage" width={100} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                      {pipelineByStage.map((entry, i) => (
                        <rect key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Activity Trend</h2>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activityTrend} margin={{ left: 0, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="Calls" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="Meetings" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Tasks + Recent Activity */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900">My Open Tasks</h2>
                <Link href="/tasks" className="text-xs font-medium hover:underline" style={{ color: '#1a4731' }}>View all →</Link>
              </div>
              {taskList.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">All tasks complete!</p>
              ) : (
                <ul className="space-y-2">
                  {taskList.map((task) => {
                    const isOverdue = task.dueDate < TODAY;
                    const isDueToday = task.dueDate === TODAY;
                    const accountName = getAccountName(task.relatedAccountId);
                    return (
                      <li key={task.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                        <button onClick={() => toggleTask(task.id)} className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 border-gray-300 hover:border-green-500 transition-colors" aria-label="Mark complete" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{task.subject}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : isDueToday ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                              {isDueToday ? 'Due today' : isOverdue ? `Overdue · ${formatDate(task.dueDate)}` : formatDate(task.dueDate)}
                            </span>
                            {accountName && <span className="text-xs text-gray-400 truncate">· {accountName}</span>}
                          </div>
                        </div>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${task.priority === 'High' ? 'bg-red-50 text-red-600' : task.priority === 'Medium' ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-500'}`}>
                          {task.priority}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Recent Activity</h2>
              <ul className="space-y-3">
                {recentActivities.map((act) => {
                  const contactName = getContactName(act.contactId);
                  const accountName = getAccountName(act.accountId);
                  return (
                    <li key={act.id} className="flex gap-3 pb-3 border-b border-gray-50 last:border-0">
                      <span className="text-lg flex-shrink-0 mt-0.5">{typeIcon[act.type]}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-gray-800 leading-tight line-clamp-1">{act.subject}</p>
                          <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">{formatDate(act.date)}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {contactName && <span>{contactName}</span>}
                          {contactName && accountName && <span className="text-gray-300"> · </span>}
                          {accountName && <Link href={`/accounts/${act.accountId}`} className="hover:underline" style={{ color: '#1a4731' }}>{accountName}</Link>}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{act.description}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* Activity Leaderboard */}
          {leaderboard.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mt-6">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">Activity Leaderboard</h2>
                <p className="text-xs text-gray-500 mt-0.5">Monthly points: Call=3, Meeting=5, Email=2, Note=1</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="w-10 text-center px-3 py-2.5 text-xs text-gray-500">#</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Team Member</th>
                    <th className="text-center px-3 py-2.5 text-xs text-gray-500 font-medium">Calls</th>
                    <th className="text-center px-3 py-2.5 text-xs text-gray-500 font-medium">Meetings</th>
                    <th className="text-center px-3 py-2.5 text-xs text-gray-500 font-medium">Emails</th>
                    <th className="text-center px-3 py-2.5 text-xs text-gray-500 font-medium">Notes</th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Points</th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">vs Last Month</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.slice(0, 10).map((entry, i) => {
                    const trend = entry.prevPoints > 0 ? Math.round(((entry.points - entry.prevPoints) / entry.prevPoints) * 100) : null;
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
                    return (
                      <tr key={entry.user.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className="text-center px-3 py-3 text-xs text-gray-400">{medal || i + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0"
                              style={{ backgroundColor: '#1a4731' }}>
                              {entry.user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                            </div>
                            <span className="font-medium text-gray-800">{entry.user.name}</span>
                          </div>
                        </td>
                        <td className="text-center px-3 py-3 text-blue-600 font-medium">{entry.calls || '-'}</td>
                        <td className="text-center px-3 py-3 text-purple-600 font-medium">{entry.meetings || '-'}</td>
                        <td className="text-center px-3 py-3 text-green-600 font-medium">{entry.emails || '-'}</td>
                        <td className="text-center px-3 py-3 text-gray-500">{entry.notes || '-'}</td>
                        <td className="text-right px-4 py-3 font-bold" style={{ color: '#1a4731' }}>{entry.points}</td>
                        <td className="text-right px-4 py-3">
                          {trend !== null ? (
                            <span className={`text-xs font-medium ${trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {trend >= 0 ? '↑' : '↓'}{Math.abs(trend)}%
                            </span>
                          ) : entry.points > 0 ? (
                            <span className="text-xs text-green-600 font-medium">NEW</span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Quota Modal */}
      {showQuotaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && setShowQuotaModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Set Monthly Quota</h2>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quota Target ($)</label>
            <input
              type="number"
              value={quotaInput}
              onChange={(e) => setQuotaInput(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-4"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowQuotaModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={saveQuota} className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {quickLogType && (
        <QuickLogModal
          onClose={() => setQuickLogType(null)}
          initialType={quickLogType}
        />
      )}
    </div>
  );
}
