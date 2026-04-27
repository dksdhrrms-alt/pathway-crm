'use client';

import { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import TopBar from '@/app/components/TopBar';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from 'recharts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COLORS = ['#1a4731', '#185FA5', '#854F0B', '#534AB7', '#0F6E56', '#993556'];

function fmt(n: number) {
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
  return '$' + Math.round(n).toLocaleString();
}

export default function InsightsPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const isAdmin = ['administrative_manager', 'admin', 'ceo', 'sales_director', 'coo'].includes(role);

  const { saleRecords, opportunities, activities, accounts, tasks, loading } = useCRM();
  const { users } = useUsers();

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const curMonth = new Date().getMonth() + 1;

  // Monthly revenue trend (current year vs last year)
  const revenueTrend = useMemo(() => {
    return MONTHS.map((m, i) => {
      const mo = i + 1;
      const cur = saleRecords.filter((r) => {
        const d = String(r.date || '').split('-');
        return parseInt(d[0]) === selectedYear && parseInt(d[1]) === mo;
      }).reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const prev = saleRecords.filter((r) => {
        const d = String(r.date || '').split('-');
        return parseInt(d[0]) === selectedYear - 1 && parseInt(d[1]) === mo;
      }).reduce((s, r) => s + (Number(r.amount) || 0), 0);
      return { month: m, [String(selectedYear)]: cur, [String(selectedYear - 1)]: prev };
    });
  }, [saleRecords, selectedYear]);

  // Category breakdown (pie chart)
  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    saleRecords.forEach((r) => {
      const d = String(r.date || '').split('-');
      if (parseInt(d[0]) !== selectedYear) return;
      const cat = r.category || 'other';
      map[cat] = (map[cat] || 0) + (Number(r.amount) || 0);
    });
    const labels: Record<string, string> = { monogastrics: 'Poultry', ruminants: 'Ruminant', latam: 'LATAM', familyb2b: 'Family/B2B', swine: 'Swine' };
    return Object.entries(map).map(([k, v]) => ({ name: labels[k] || k, value: v })).sort((a, b) => b.value - a.value);
  }, [saleRecords, selectedYear]);

  // Top 10 accounts by revenue
  const topAccounts = useMemo(() => {
    const map: Record<string, number> = {};
    saleRecords.forEach((r) => {
      const d = String(r.date || '').split('-');
      if (parseInt(d[0]) !== selectedYear) return;
      const acct = r.accountName || 'Unknown';
      map[acct] = (map[acct] || 0) + (Number(r.amount) || 0);
    });
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 10).map(([name, value]) => ({ name, value }));
  }, [saleRecords, selectedYear]);

  // Pipeline by stage
  const pipelineByStage = useMemo(() => {
    const stages = ['Prospect', 'Prospecting', 'Qualified', 'Qualification', 'Trial Started', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];
    return stages.map((s) => {
      const opps = opportunities.filter((o) => o.stage === s);
      return { stage: s, count: opps.length, value: opps.reduce((sum, o) => sum + (o.amount || 0), 0) };
    });
  }, [opportunities]);

  // Activity trend (last 6 months)
  const activityTrend = useMemo(() => {
    const result: { month: string; Call: number; Meeting: number; Email: number; Note: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const prefix = `${y}-${String(m).padStart(2, '0')}`;
      const acts = activities.filter((a) => a.date?.startsWith(prefix));
      result.push({
        month: MONTHS[m - 1],
        Call: acts.filter((a) => a.type === 'Call').length,
        Meeting: acts.filter((a) => a.type === 'Meeting').length,
        Email: acts.filter((a) => a.type === 'Email').length,
        Note: acts.filter((a) => a.type === 'Note').length,
      });
    }
    return result;
  }, [activities]);

  // Key metrics
  const totalRevYTD = saleRecords.filter((r) => { const d = String(r.date || '').split('-'); return parseInt(d[0]) === selectedYear && parseInt(d[1]) <= curMonth; }).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalRevLastYTD = saleRecords.filter((r) => { const d = String(r.date || '').split('-'); return parseInt(d[0]) === selectedYear - 1 && parseInt(d[1]) <= curMonth; }).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const yoyGrowth = totalRevLastYTD > 0 ? Math.round(((totalRevYTD - totalRevLastYTD) / totalRevLastYTD) * 100) : 0;
  const openPipeline = opportunities.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').reduce((s, o) => s + (o.amount || 0), 0);
  const winRate = (() => { const closed = opportunities.filter((o) => o.stage === 'Closed Won' || o.stage === 'Closed Lost'); return closed.length > 0 ? Math.round((closed.filter((o) => o.stage === 'Closed Won').length / closed.length) * 100) : 0; })();
  const avgDealSize = (() => { const won = opportunities.filter((o) => o.stage === 'Closed Won'); return won.length > 0 ? Math.round(won.reduce((s, o) => s + (o.amount || 0), 0) / won.length) : 0; })();

  // Inactive accounts (no activity in 30+ days)
  const inactiveAccounts = useMemo(() => {
    const now = new Date().getTime();
    return accounts.filter((acct) => {
      const acctActs = activities.filter((a) => a.accountId === acct.id);
      if (acctActs.length === 0) return true;
      const latest = Math.max(...acctActs.map((a) => new Date(a.date + 'T00:00:00').getTime()));
      return (now - latest) / 86400000 > 30;
    }).length;
  }, [accounts, activities]);

  // Overdue tasks
  const overdueTasks = tasks.filter((t) => t.status === 'Open' && t.dueDate < new Date().toISOString().split('T')[0]).length;

  // AI Insight generation
  async function generateAIInsight() {
    setAiLoading(true);
    try {
      const summary = {
        ytdRevenue: fmt(totalRevYTD),
        yoyGrowth: yoyGrowth + '%',
        openPipeline: fmt(openPipeline),
        winRate: winRate + '%',
        avgDealSize: fmt(avgDealSize),
        topCategories: categoryBreakdown.slice(0, 3).map((c) => `${c.name}: ${fmt(c.value)}`).join(', '),
        topAccounts: topAccounts.slice(0, 5).map((a) => `${a.name}: ${fmt(a.value)}`).join(', '),
        totalActivities: activities.length,
        inactiveAccounts,
        overdueTasks,
        activeDeals: opportunities.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').length,
      };

      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: { ...summary, year: selectedYear } }),
      });

      const data = await res.json();
      if (res.ok && data.insight) {
        setAiInsight(data.insight);
      } else {
        // Fallback: generate insights from data
        const insights = [];
        if (yoyGrowth > 0) insights.push(`Revenue is up ${yoyGrowth}% YoY - strong growth trajectory.`);
        else if (yoyGrowth < 0) insights.push(`Revenue is down ${Math.abs(yoyGrowth)}% YoY - needs attention.`);
        if (winRate < 30) insights.push(`Win rate at ${winRate}% is below target. Review qualification criteria.`);
        if (inactiveAccounts > 5) insights.push(`${inactiveAccounts} accounts haven't been contacted in 30+ days. Schedule follow-ups.`);
        if (overdueTasks > 0) insights.push(`${overdueTasks} overdue tasks need immediate attention.`);
        if (topAccounts.length > 0) insights.push(`Top account ${topAccounts[0].name} contributing ${fmt(topAccounts[0].value)} YTD.`);
        insights.push(`Open pipeline at ${fmt(openPipeline)} across ${opportunities.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').length} deals.`);
        setAiInsight(insights.join('\n\n'));
      }
    } catch {
      setAiInsight('Failed to generate AI insights. Please try again.');
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mt-6 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Data Insights</h1>
              <p className="text-sm text-gray-500 mt-0.5">Sales trends, pipeline analysis, and AI-powered recommendations</p>
            </div>
            <div className="flex items-center gap-3">
              <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                {[2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button onClick={generateAIInsight} disabled={aiLoading}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all"
                style={{ backgroundColor: aiLoading ? '#e5e7eb' : '#1a4731', color: aiLoading ? '#888' : 'white', cursor: aiLoading ? 'not-allowed' : 'pointer' }}>
                {aiLoading ? 'Analyzing...' : 'AI Insights'}
              </button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            {[
              { label: 'YTD Revenue', value: fmt(totalRevYTD), sub: `${yoyGrowth >= 0 ? '+' : ''}${yoyGrowth}% YoY`, color: yoyGrowth >= 0 ? '#0F6E56' : '#E24B4A' },
              { label: 'Open Pipeline', value: fmt(openPipeline), sub: `${opportunities.filter((o) => o.stage !== 'Closed Won' && o.stage !== 'Closed Lost').length} deals`, color: '#185FA5' },
              { label: 'Win Rate', value: winRate + '%', sub: `Avg deal ${fmt(avgDealSize)}`, color: winRate >= 40 ? '#0F6E56' : '#854F0B' },
              { label: 'Inactive Accounts', value: String(inactiveAccounts), sub: '30+ days no contact', color: inactiveAccounts > 5 ? '#E24B4A' : '#0F6E56' },
              { label: 'Overdue Tasks', value: String(overdueTasks), sub: 'Need attention', color: overdueTasks > 0 ? '#E24B4A' : '#0F6E56' },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs font-medium text-gray-500 uppercase">{kpi.label}</p>
                <p className="text-2xl font-bold mt-1" style={{ color: kpi.color }}>{kpi.value}</p>
                <p className="text-xs mt-0.5" style={{ color: kpi.color }}>{kpi.sub}</p>
              </div>
            ))}
          </div>

          {/* AI Insights Panel */}
          {aiInsight && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6" style={{ borderLeft: '4px solid #1a4731' }}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">AI Analysis</h2>
                <button onClick={() => setAiInsight(null)} className="text-gray-400 hover:text-gray-600 text-sm">Dismiss</button>
              </div>
              <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{aiInsight}</div>
            </div>
          )}

          {/* Charts Row 1: Revenue Trend + Category Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Revenue Trend */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Revenue Trend - {selectedYear} vs {selectedYear - 1}</h2>
              <div className="chart-scroll-wrapper" style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: '500px', height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={revenueTrend} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={(v) => fmt(v)} width={60} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => fmt(Number(v))} />
                      <Legend />
                      <Line type="monotone" dataKey={String(selectedYear)} stroke="#1a4731" strokeWidth={2.5} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey={String(selectedYear - 1)} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Category Pie */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Revenue by Category</h2>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent, x, y }) => <text x={x} y={y} textAnchor="middle" dominantBaseline="central" style={{ fontSize: '11px', fill: '#444' }}>{name} {((percent || 0) * 100).toFixed(0)}%</text>} labelLine={false}>
                      {categoryBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmt(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-1">
                {categoryBreakdown.slice(0, 4).map((c, i) => (
                  <div key={c.name} className="flex justify-between text-xs">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i] }} />{c.name}</span>
                    <span className="font-medium">{fmt(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Charts Row 2: Top Accounts + Activity Trend */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Top Accounts */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Top 10 Accounts by Revenue</h2>
              <div className="chart-scroll-wrapper" style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: '400px', height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topAccounts} layout="vertical" margin={{ left: 10, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => fmt(v)} tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v) => fmt(Number(v))} />
                      <Bar dataKey="value" fill="#1a4731" radius={[0, 4, 4, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Activity Trend */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Activity Trend (Last 6 Months)</h2>
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activityTrend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Call" stackId="a" fill="#3b82f6" barSize={30} />
                    <Bar dataKey="Meeting" stackId="a" fill="#8b5cf6" />
                    <Bar dataKey="Email" stackId="a" fill="#22c55e" />
                    <Bar dataKey="Note" stackId="a" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Pipeline by Stage */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Pipeline by Stage</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {pipelineByStage.map((s) => {
                const stageColor: Record<string, string> = { Prospect: '#94a3b8', Prospecting: '#6366f1', Qualified: '#06b6d4', Qualification: '#3b82f6', 'Trial Started': '#14b8a6', Proposal: '#f59e0b', Negotiation: '#f97316', 'Closed Won': '#22c55e', 'Closed Lost': '#ef4444' };
                return (
                  <div key={s.stage} className="bg-gray-50 rounded-lg p-4 text-center">
                    <div className="w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: stageColor[s.stage] || '#888' }}>
                      {s.count}
                    </div>
                    <p className="text-xs font-medium text-gray-700">{s.stage}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{fmt(s.value)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
