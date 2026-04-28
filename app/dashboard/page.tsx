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
import NewTaskModal from '@/app/components/NewTaskModal';
import NewOpportunityModal from '@/app/components/NewOpportunityModal';
import NewAccountModal from '@/app/components/NewAccountModal';
import NewContactModal from '@/app/components/NewContactModal';
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
  Prospect: '#94a3b8',
  Prospecting: '#6366f1',
  Qualified: '#06b6d4',
  Qualification: '#f59e0b',
  'Trial Started': '#14b8a6',
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
  const canViewCompany = isAdminCeo;
  const canViewTeam = isAdminCeo || ['sales_director', 'coo'].includes(role);

  const { opportunities: allOpps, tasks: allTasks, activities: allActivities, accounts, contacts, toggleTask, loading } = useCRM();
  const { users } = useUsers();

  const [activeTab, setActiveTab] = useState<'company' | 'team' | 'personal'>(
    canViewCompany ? 'company' : canViewTeam ? 'team' : 'personal'
  );

  // Auto-correct if state ever holds an unauthorized view
  useEffect(() => {
    if (activeTab === 'company' && !canViewCompany) setActiveTab(canViewTeam ? 'team' : 'personal');
    else if (activeTab === 'team' && !canViewTeam) setActiveTab('personal');
  }, [activeTab, canViewCompany, canViewTeam]);
  const [toast, setToast] = useState<string | null>(null);
  const [quotaTarget, setQuotaTarget] = useState(500000);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [quotaInput, setQuotaInput] = useState('500000');
  const [quickLogType, setQuickLogType] = useState<ActivityType | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showNewOpp, setShowNewOpp] = useState(false);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [showNewContact, setShowNewContact] = useState(false);

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
    const stages: Stage[] = ['Prospect', 'Prospecting', 'Qualified', 'Qualification', 'Trial Started', 'Proposal', 'Negotiation', 'Closed Won'];
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
  const ACT_POINTS: Record<string, number> = { Call: 3, Meeting: 5, Email: 2, Note: 1 };
  const TASK_COMPLETE_PTS = 2;
  const OPP_WON_PTS = 2;
  const leaderboard = useMemo(() => {
    const curPrefix = CURRENT_MONTH;
    const prevDate = new Date(); prevDate.setMonth(prevDate.getMonth() - 1);
    const prevPrefix = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const activeUsersList = users.filter((u) => u.status === 'active');
    return activeUsersList.map((u) => {
      const curActs = allActivities.filter((a) => a.ownerId === u.id && a.date?.startsWith(curPrefix) && !a.subject?.startsWith('[SYSTEM]'));
      const prevActs = allActivities.filter((a) => a.ownerId === u.id && a.date?.startsWith(prevPrefix) && !a.subject?.startsWith('[SYSTEM]'));
      // Tasks completed (status=Completed, dueDate in current or recent month)
      const tasksCompleted = allTasks.filter((t) => t.ownerId === u.id && t.status === 'Completed' && (t.dueDate?.startsWith(curPrefix) || t.dueDate?.startsWith(prevPrefix))).length;
      // New opportunities created this month
      const oppsWon = allOpps.filter((o) => o.ownerId === u.id && o.createdDate?.startsWith(curPrefix)).length;
      const actPts = curActs.reduce((s, a) => s + (ACT_POINTS[a.type] || 1), 0);
      const curPts = actPts + (tasksCompleted * TASK_COMPLETE_PTS) + (oppsWon * OPP_WON_PTS);
      const prevPts = prevActs.reduce((s, a) => s + (ACT_POINTS[a.type] || 1), 0);
      const calls = curActs.filter((a) => a.type === 'Call').length;
      const meetings = curActs.filter((a) => a.type === 'Meeting').length;
      const emails = curActs.filter((a) => a.type === 'Email').length;
      const notes = curActs.filter((a) => a.type === 'Note').length;
      return { user: u, points: curPts, prevPoints: prevPts, total: curActs.length, calls, meetings, emails, notes, tasksCompleted, oppsWon };
    }).filter((x) => x.total > 0 || x.points > 0 || x.prevPoints > 0 || x.tasksCompleted > 0 || x.oppsWon > 0)
      .sort((a, b) => b.points - a.points);
  }, [allActivities, allTasks, allOpps, users]);

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

          {/* Urgent alert banner \u2014 replaced by My Focus panel */}

          {/* ============ NEW HEADER ============ */}
          <div className="mt-6 mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
              <h1 className="text-3xl font-bold text-gray-900">
                {(() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })()},{' '}
                <span style={{ color: '#1a4731' }}>{userName.split(' ')[0] || 'there'}</span>
                <span className="text-gray-400">.</span>
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {activeTab === 'company' ? '🏢 Company-wide view' : activeTab === 'team' ? `👥 ${teamLabel} team view` : '👤 Your personal view'}
                <span className="text-gray-300 ml-2">·</span> <span className="text-gray-400">Last updated just now</span>
              </p>
            </div>
            {/* View tabs */}
            {(canViewCompany || canViewTeam) && (
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                {canViewCompany && (
                  <button onClick={() => setActiveTab('company')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${activeTab === 'company' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    style={activeTab === 'company' ? { backgroundColor: '#1a4731', color: 'white' } : {}}>
                    Company-wide
                  </button>
                )}
                {canViewTeam && (
                  <button onClick={() => setActiveTab('team')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${activeTab === 'team' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    style={activeTab === 'team' ? { backgroundColor: '#1a4731', color: 'white' } : {}}>
                    {teamLabel || 'Team'}
                  </button>
                )}
                <button onClick={() => setActiveTab('personal')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${activeTab === 'personal' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  style={activeTab === 'personal' ? { backgroundColor: '#1a4731', color: 'white' } : {}}>
                  Personal
                </button>
              </div>
            )}
          </div>

          {/* ============ QUICK ACTIONS — open modals directly ============ */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            {[
              { id: 'log', label: 'Log Activity', sub: 'Quick log a call/meeting', emoji: '📝', onClick: () => setQuickLogType('Call') },
              { id: 'task', label: 'New Task', sub: 'Schedule a follow-up', emoji: '✅', onClick: () => setShowNewTask(true) },
              { id: 'opp', label: 'New Opportunity', sub: 'Add a deal', emoji: '🎯', onClick: () => setShowNewOpp(true) },
              { id: 'account', label: 'New Account', sub: 'Add a customer', emoji: '🏢', onClick: () => setShowNewAccount(true) },
              { id: 'contact', label: 'New Contact', sub: 'Add a person', emoji: '👤', onClick: () => setShowNewContact(true) },
            ].map((a) => (
              <button key={a.id} onClick={a.onClick} className="text-left">
                <div className="bg-white border border-gray-200 hover:border-green-400 hover:shadow-md transition-all rounded-xl p-4 cursor-pointer h-full">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0" style={{ backgroundColor: '#f0f7ee' }}>{a.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">+ {a.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{a.sub}</p>
                    </div>
                  </div>
                </div>
              </button>
            ))}
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

          {/* ============ MY FOCUS + MY DEALS ============ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* MY FOCUS — left column */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">🎯 My Focus</h2>
                  <p className="text-[11px] text-gray-400 mt-0.5">What needs your attention today</p>
                </div>
              </div>
              <div className="divide-y divide-gray-50">
                {(() => {
                  const todayMs = new Date().getTime();
                  const items: Array<{ icon: string; label: string; sub: string; count: number; link: string; color: string }> = [];
                  // Overdue tasks (own)
                  const myOverdue = allTasks.filter((t) => t.ownerId === userId && t.status !== 'Completed' && t.dueDate && t.dueDate < TODAY);
                  if (myOverdue.length > 0) items.push({ icon: '⚠️', label: 'Overdue tasks', sub: `Past due deadline`, count: myOverdue.length, link: '/tasks', color: '#dc2626' });
                  // Due today
                  const myDueToday = allTasks.filter((t) => t.ownerId === userId && t.status !== 'Completed' && t.dueDate === TODAY);
                  if (myDueToday.length > 0) items.push({ icon: '📋', label: 'Tasks due today', sub: 'Wrap up by end of day', count: myDueToday.length, link: '/tasks', color: '#d97706' });
                  // Closing within 7 days (own)
                  const myClosing = allOpps.filter((o) => {
                    if (o.ownerId !== userId || !o.closeDate || o.stage === 'Closed Won' || o.stage === 'Closed Lost') return false;
                    const days = Math.floor((new Date(o.closeDate + 'T00:00:00').getTime() - todayMs) / 86400000);
                    return days >= 0 && days <= 7;
                  });
                  if (myClosing.length > 0) items.push({ icon: '🎯', label: 'Deals closing this week', sub: `${formatCompact(myClosing.reduce((s, o) => s + (Number(o.amount) || 0), 0))} at stake`, count: myClosing.length, link: '/opportunities', color: '#2563eb' });
                  // Complexes neglected (own children, 60+ days)
                  const myNeglectedChildren = accounts
                    .filter((a) => a.parentAccountId && a.ownerId === userId)
                    .filter((a) => {
                      const acts = allActivities.filter((x) => x.accountId === a.id);
                      const last = acts.length > 0 ? acts.map((x) => x.date).sort().reverse()[0] : '';
                      const days = last ? Math.floor((todayMs - new Date(last + 'T00:00:00').getTime()) / 86400000) : 999;
                      return days >= 60;
                    });
                  if (myNeglectedChildren.length > 0) {
                    // For single neglected complex → go to that account directly.
                    // For multiple → go to the parent integration's detail (shows full Complex table with status).
                    const first = myNeglectedChildren[0];
                    const allSameParent = myNeglectedChildren.every((c) => c.parentAccountId === first.parentAccountId);
                    const targetId = (myNeglectedChildren.length === 1 || !allSameParent) ? first.id : (first.parentAccountId || first.id);
                    items.push({ icon: '◆', label: 'Complexes neglected', sub: 'No contact in 60+ days', count: myNeglectedChildren.length, link: `/accounts/${targetId}`, color: '#7c3aed' });
                  }
                  // Birthdays this week
                  const today = new Date();
                  const upcomingBirthdays = contacts.filter((c) => {
                    if (!c.birthday) return false;
                    const md = c.birthday.substring(5);
                    const eventDate = new Date(today.getFullYear(), parseInt(md.split('-')[0]) - 1, parseInt(md.split('-')[1]));
                    const diff = Math.floor((eventDate.getTime() - today.getTime()) / 86400000);
                    return diff >= 0 && diff <= 7;
                  });
                  if (upcomingBirthdays.length > 0) items.push({ icon: '🎂', label: 'Birthdays this week', sub: 'Send a quick note', count: upcomingBirthdays.length, link: '/contacts', color: '#db2777' });

                  if (items.length === 0) {
                    return (
                      <div className="p-8 text-center">
                        <div className="text-4xl mb-2">🌟</div>
                        <p className="text-sm font-medium text-gray-700">All clear!</p>
                        <p className="text-xs text-gray-400 mt-1">Nothing urgent today. Great work.</p>
                      </div>
                    );
                  }
                  return items.map((item, i) => (
                    <Link key={i} href={item.link} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <span className="text-xl flex-shrink-0">{item.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{item.label}</p>
                        <p className="text-[11px] text-gray-400">{item.sub}</p>
                      </div>
                      <span className="text-base font-bold flex-shrink-0" style={{ color: item.color }}>{item.count}</span>
                      <span className="text-gray-300">→</span>
                    </Link>
                  ));
                })()}
              </div>
            </div>

            {/* MY DEALS — right column (spans 2) */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">💼 My Deals</h2>
                  <p className="text-[11px] text-gray-400 mt-0.5">Pipeline snapshot</p>
                </div>
                <Link href="/opportunities" className="text-xs font-medium hover:underline" style={{ color: '#1a4731' }}>View all →</Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-50">
                <div className="p-5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Open Deals</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{openOpps.length}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Active pipeline</p>
                </div>
                <div className="p-5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Pipeline Value</p>
                  <p className="text-2xl font-bold mt-1" style={{ color: '#1a4731' }}>{formatCompact(pipelineValue)}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Sum of open</p>
                </div>
                <div className="p-5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Weighted</p>
                  <p className="text-2xl font-bold text-blue-700 mt-1">{formatCompact(openOpps.reduce((s, o) => s + (Number(o.amount) || 0) * ((Number(o.probability) || 0) / 100), 0))}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">× probability</p>
                </div>
                <div className="p-5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Won This Month</p>
                  <p className="text-2xl font-bold text-green-600 mt-1">{wonThisMonth.length}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{formatCompact(wonAmount)}</p>
                </div>
              </div>
              {/* Mini stage strip */}
              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Stage Distribution</p>
                <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-gray-200">
                  {pipelineByStage.filter((s) => s.amount > 0 && s.stage !== 'Closed Won').map((s) => (
                    <div
                      key={s.stage}
                      style={{ width: `${pipelineValue > 0 ? (s.amount / pipelineValue) * 100 : 0}%`, backgroundColor: s.fill }}
                      title={`${s.stage}: ${formatCurrency(s.amount)}`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                  {pipelineByStage.filter((s) => s.amount > 0 && s.stage !== 'Closed Won').map((s) => (
                    <div key={s.stage} className="flex items-center gap-1 text-[11px]">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.fill }} />
                      <span className="text-gray-600">{s.stage}</span>
                      <span className="text-gray-400">· {formatCompact(s.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Activity Leaderboard — DISABLED per redesign. Set to `true` to re-enable. */}
          {false && leaderboard.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">Activity Leaderboard</h2>
                <p className="text-xs text-gray-500 mt-0.5">Call=3 Meeting=5 Email=2 Note=1 Task Done=2 New Opp=2</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="w-10 text-center px-3 py-2.5 text-xs text-gray-500">#</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Team Member</th>
                    <th className="text-center px-2 py-2.5 text-xs text-gray-500 font-medium">Calls</th>
                    <th className="text-center px-2 py-2.5 text-xs text-gray-500 font-medium">Meetings</th>
                    <th className="text-center px-2 py-2.5 text-xs text-gray-500 font-medium">Emails</th>
                    <th className="text-center px-2 py-2.5 text-xs text-gray-500 font-medium">Notes</th>
                    <th className="text-center px-2 py-2.5 text-xs text-gray-500 font-medium">Tasks</th>
                    <th className="text-center px-2 py-2.5 text-xs text-gray-500 font-medium">Opps</th>
                    <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Points</th>
                    <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">vs LM</th>
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
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0" style={{ backgroundColor: '#1a4731' }}>
                              {entry.user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                            </div>
                            <span className="font-medium text-gray-800">{entry.user.name}</span>
                          </div>
                        </td>
                        <td className="text-center px-2 py-3 text-blue-600 font-medium">{entry.calls || '-'}</td>
                        <td className="text-center px-2 py-3 text-purple-600 font-medium">{entry.meetings || '-'}</td>
                        <td className="text-center px-2 py-3 text-green-600 font-medium">{entry.emails || '-'}</td>
                        <td className="text-center px-2 py-3 text-gray-500">{entry.notes || '-'}</td>
                        <td className="text-center px-2 py-3 text-amber-600 font-medium">{entry.tasksCompleted || '-'}</td>
                        <td className="text-center px-2 py-3 text-teal-600 font-medium">{entry.oppsWon || '-'}</td>
                        <td className="text-right px-3 py-3 font-bold" style={{ color: '#1a4731' }}>{entry.points}</td>
                        <td className="text-right px-3 py-3">
                          {trend !== null ? (
                            <span className={`text-xs font-medium ${trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>{trend >= 0 ? '↑' : '↓'}{Math.abs(trend)}%</span>
                          ) : entry.points > 0 ? (
                            <span className="text-xs text-green-600 font-medium">NEW</span>
                          ) : <span className="text-xs text-gray-400">-</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ============ Recent Activity + My Tasks 2-column ============ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recent Activity — each row links directly to its account */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900">Recent Activity</h2>
                <span className="text-xs text-gray-400">Click to open account</span>
              </div>
              {recentActivities.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No recent activity yet.</p>
              ) : (
                <ul className="space-y-1">
                  {recentActivities.map((act) => {
                    const contactName = getContactName(act.contactId);
                    const accountName = getAccountName(act.accountId);
                    const row = (
                      <div className="flex gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors">
                        <span className="text-lg flex-shrink-0 mt-0.5">{typeIcon[act.type]}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-gray-800 leading-tight line-clamp-1">{act.subject}</p>
                            <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">{formatDate(act.date)}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {contactName && <span>{contactName}</span>}
                            {contactName && accountName && <span className="text-gray-300"> · </span>}
                            {accountName && <span style={{ color: '#1a4731' }} className="font-medium">{accountName}</span>}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{act.description}</p>
                        </div>
                      </div>
                    );
                    return (
                      <li key={act.id} className="border-b border-gray-50 last:border-0">
                        {act.accountId ? (
                          <Link href={`/accounts/${act.accountId}`} className="block">{row}</Link>
                        ) : row}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* My Tasks — open tasks, sorted by due date with overdue / due-today badges */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900">My Tasks</h2>
                <Link href="/tasks" className="text-xs font-medium hover:underline" style={{ color: '#1a4731' }}>View all →</Link>
              </div>
              {taskList.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-3xl mb-1">✅</div>
                  <p className="text-sm font-medium text-gray-700">All caught up!</p>
                  <p className="text-xs text-gray-400 mt-0.5">No open tasks right now.</p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {taskList.slice(0, 12).map((task) => {
                    const isOverdue = task.dueDate < TODAY;
                    const isDueToday = task.dueDate === TODAY;
                    const accountName = getAccountName(task.relatedAccountId);
                    const priorityColor = task.priority === 'High' ? 'bg-red-50 text-red-600' : task.priority === 'Medium' ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-500';
                    return (
                      <li key={task.id} className={`flex items-start gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 ${isOverdue ? 'bg-red-50/30' : ''}`}>
                        <button
                          onClick={(e) => { e.preventDefault(); toggleTask(task.id); setToast('Task completed'); }}
                          className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 border-gray-300 hover:border-green-500 hover:bg-green-50 transition-colors"
                          aria-label="Mark complete"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{task.subject}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : isDueToday ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                              {isDueToday ? 'Due today' : isOverdue ? `Overdue · ${formatDate(task.dueDate)}` : `Due ${formatDate(task.dueDate)}`}
                            </span>
                            {accountName && <span className="text-xs text-gray-400 truncate">· {accountName}</span>}
                          </div>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${priorityColor}`}>
                          {task.priority}
                        </span>
                      </li>
                    );
                  })}
                  {taskList.length > 12 && (
                    <li className="text-center pt-2">
                      <Link href="/tasks" className="text-xs text-gray-500 hover:text-gray-700 underline">+{taskList.length - 12} more</Link>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>

        </div>
      </main>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {quickLogType && (
        <QuickLogModal
          onClose={() => setQuickLogType(null)}
          initialType={quickLogType}
        />
      )}

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onSave={() => { setShowNewTask(false); setToast('Task created'); }}
        />
      )}

      {showNewOpp && (
        <NewOpportunityModal
          onClose={() => setShowNewOpp(false)}
          onSave={() => { setShowNewOpp(false); setToast('Opportunity created'); }}
        />
      )}

      {showNewAccount && (
        <NewAccountModal
          onClose={() => setShowNewAccount(false)}
          onSave={() => { setShowNewAccount(false); setToast('Account created'); }}
        />
      )}

      {showNewContact && (
        <NewContactModal
          onClose={() => setShowNewContact(false)}
          onSave={() => { setShowNewContact(false); setToast('Contact created'); }}
        />
      )}
    </div>
  );
}
