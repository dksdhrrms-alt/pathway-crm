'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, Line, ComposedChart,
} from 'recharts';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';
import { getBudgets, setBudget, setBudgetBulk, getBudgetAmount, BudgetEntry, BudgetCategory, getSeedBudgets } from '@/lib/budgetStore';
import { useCRM } from '@/lib/CRMContext';
void getSeedBudgets; // used elsewhere
import * as XLSX from 'xlsx';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CURRENT_MONTH = new Date().getMonth() + 1; // 1-12
const CURRENT_YEAR = new Date().getFullYear();

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All Categories', monogastrics: 'Monogastrics', ruminants: 'Ruminants', latam: 'LATAM', familyb2b: 'Family / B2B',
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtCompact(n: number) {
  if (n >= 1000000) return `$${(n/1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n/1000).toFixed(0)}K`;
  return `$${n}`;
}

function pctColor(pct: number) {
  if (pct >= 80) return '#22c55e';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}

function statusBadge(pct: number, hasData: boolean) {
  if (!hasData) return { label: 'No Data', cls: 'bg-gray-100 text-gray-500' };
  if (pct >= 80) return { label: 'On Track', cls: 'bg-green-100 text-green-700' };
  if (pct >= 50) return { label: 'At Risk', cls: 'bg-amber-100 text-amber-700' };
  return { label: 'Behind', cls: 'bg-red-100 text-red-700' };
}

export default function SalesDashboardPage() {
  const params = useParams();
  const category = (params.category as BudgetCategory) || 'all';
  const { data: session } = useSession();
  const isAdmin = ['administrative_manager','admin','ceo','sales_director','coo'].includes(session?.user?.role ?? '');

  const { saleRecords: salesData } = useCRM();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [budgets, setBudgets] = useState<BudgetEntry[]>([]);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingMonth, setEditingMonth] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  // Load data
  const loadBudgets = useCallback(async () => {
    if (category === 'all') {
      const [m, r, l, f] = await Promise.all([
        getBudgets(year, 'monogastrics'), getBudgets(year, 'ruminants'), getBudgets(year, 'latam'), getBudgets(year, 'familyb2b'),
      ]);
      const combined: BudgetEntry[] = [];
      for (let mo = 1; mo <= 12; mo++) {
        combined.push({
          id: `all-${year}-${mo}`, year, month: mo, category: 'all',
          budgetAmount: getBudgetAmount(m, mo) + getBudgetAmount(r, mo) + getBudgetAmount(l, mo) + getBudgetAmount(f, mo),
        });
      }
      setBudgets(combined);
    } else {
      setBudgets(await getBudgets(year, category));
    }
  }, [year, category]);

  useEffect(() => { loadBudgets(); }, [loadBudgets]);

  // Compute actuals from raw sales data
  const monthlyActuals = useMemo(() => {
    const result: number[] = new Array(12).fill(0);
    for (const r of salesData) {
      if (!r.date) continue;
      const parts = r.date.split('-');
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      if (y !== year || !m || m < 1 || m > 12) continue;
      if (category !== 'all' && r.category !== category) continue;
      result[m - 1] += (Number(r.amount) || 0);
    }
    return result;
  }, [salesData, year, category]);

  // Last year actuals for comparison
  const lastYearActuals = useMemo(() => {
    const result: number[] = new Array(12).fill(0);
    for (const r of salesData) {
      if (!r.date) continue;
      const parts = r.date.split('-');
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      if (y !== year - 1 || !m || m < 1 || m > 12) continue;
      if (category !== 'all' && r.category !== category) continue;
      result[m - 1] += (Number(r.amount) || 0);
    }
    return result;
  }, [salesData, year, category]);

  // Chart data
  const chartData = useMemo(() => {
    return MONTHS.map((m, i) => {
      const budget = getBudgetAmount(budgets, i + 1);
      const actual = monthlyActuals[i];
      const pct = budget > 0 ? Math.round((actual / budget) * 100) : 0;
      return { month: m, Budget: budget, Actual: actual, 'Achievement %': pct };
    });
  }, [budgets, monthlyActuals]);

  // Totals
  const totalBudget = budgets.reduce((s, b) => s + b.budgetAmount, 0);
  const totalActual = monthlyActuals.reduce((s, a) => s + a, 0);
  const totalPct = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;
  const curMonthBudget = getBudgetAmount(budgets, CURRENT_MONTH);
  const curMonthActual = monthlyActuals[CURRENT_MONTH - 1];
  const curMonthPct = curMonthBudget > 0 ? Math.round((curMonthActual / curMonthBudget) * 100) : 0;

  // Category breakdowns (for 'all' page)
  const categoryBreakdown = useMemo(() => {
    if (category !== 'all') return [];
    const cats: BudgetCategory[] = ['monogastrics', 'ruminants', 'latam', 'familyb2b'];
    return cats.map((cat) => {
      const catActual = salesData
        .filter((r) => r.date?.startsWith(String(year)) && r.category === cat)
        .reduce((s, r) => s + r.amount, 0);
      const catBudgetEntries = budgets; // already combined, need per-cat
      // Re-fetch from local store
      let catBudget = 0;
      try {
        const stored = localStorage.getItem('crm_sales_budgets');
        if (stored) {
          const all: BudgetEntry[] = JSON.parse(stored);
          catBudget = all.filter((b) => b.year === year && b.category === cat).reduce((s, b) => s + b.budgetAmount, 0);
        }
      } catch { /* */ }
      void catBudgetEntries;
      const pct = catBudget > 0 ? Math.round((catActual / catBudget) * 100) : 0;
      // Top product
      const products: Record<string, number> = {};
      salesData.filter((r) => r.date?.startsWith(String(year)) && r.category === cat).forEach((r) => {
        products[r.productName] = (products[r.productName] || 0) + r.amount;
      });
      const topProduct = Object.entries(products).sort((a, b) => b[1] - a[1])[0];
      return { category: cat, budget: catBudget, actual: catActual, pct, topProduct: topProduct?.[0] ?? '—' };
    });
  }, [category, salesData, year, budgets]);

  // Top accounts
  const topAccounts = useMemo(() => {
    const accts: Record<string, { amount: number; category: string; lastYear: number }> = {};
    for (const r of salesData) {
      if (!r.date?.startsWith(String(year))) continue;
      if (category !== 'all' && r.category !== category) continue;
      if (!accts[r.accountName]) accts[r.accountName] = { amount: 0, category: r.category, lastYear: 0 };
      accts[r.accountName].amount += r.amount;
    }
    for (const r of salesData) {
      if (!r.date?.startsWith(String(year - 1))) continue;
      if (category !== 'all' && r.category !== category) continue;
      if (accts[r.accountName]) accts[r.accountName].lastYear += r.amount;
    }
    return Object.entries(accts)
      .map(([name, d]) => ({ name, ...d, pctOfTotal: totalActual > 0 ? Math.round((d.amount / totalActual) * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
  }, [salesData, year, category, totalActual]);

  // Inline budget edit
  async function saveInlineEdit(month: number) {
    const val = parseInt(editValue.replace(/,/g, '')) || 0;
    if (category !== 'all') {
      await setBudget(year, month, category, val);
    }
    setEditingMonth(null);
    loadBudgets();
  }

  // Export
  function handleExport(format: 'csv' | 'xlsx') {
    const rows = MONTHS.map((m, i) => ({
      Month: m, Budget: getBudgetAmount(budgets, i + 1), Actual: monthlyActuals[i],
      'Achievement %': getBudgetAmount(budgets, i + 1) > 0 ? Math.round((monthlyActuals[i] / getBudgetAmount(budgets, i + 1)) * 100) : 0,
      'vs Last Year': lastYearActuals[i] > 0 ? `${Math.round(((monthlyActuals[i] - lastYearActuals[i]) / lastYearActuals[i]) * 100)}%` : '—',
    }));
    if (format === 'csv') {
      const csv = [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `pathway-sales-dashboard-${category}-${year}.csv`; a.click();
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Dashboard');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `pathway-sales-dashboard-${category}-${year}.xlsx`; a.click();
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mt-6 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Sales Dashboard — {CATEGORY_LABELS[category]}</h1>
              <p className="text-sm text-gray-500 mt-0.5">Budget vs Actual performance tracking</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Year pills */}
              <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
                {[2024, 2025, 2026].map((y) => (
                  <button key={y} onClick={() => setYear(y)}
                    className={`px-3 py-1 text-sm font-medium rounded transition-all ${year === y ? 'text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                    style={year === y ? { backgroundColor: '#1a4731' } : {}}
                  >{y}</button>
                ))}
              </div>
              {isAdmin && category !== 'all' && (
                <button onClick={() => setShowBudgetModal(true)}
                  className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                  Set Annual Budget
                </button>
              )}
              {/* Export dropdown */}
              <div className="relative group">
                <button className="px-3 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">Export</button>
                <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg hidden group-hover:block z-10">
                  <button onClick={() => handleExport('csv')} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50">Export CSV</button>
                  <button onClick={() => handleExport('xlsx')} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50">Export Excel</button>
                </div>
              </div>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-medium text-gray-500 uppercase">Annual Budget {year}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(totalBudget)}</p>
              <p className="text-xs text-gray-400 mt-1">Set monthly targets below</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-medium text-gray-500 uppercase">Annual Actual {year}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: '#1a4731' }}>{fmt(totalActual)}</p>
              <p className="text-xs text-gray-400 mt-1">{salesData.length} records loaded</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-medium text-gray-500 uppercase">Annual Achievement</p>
              <p className="text-2xl font-bold mt-1" style={{ color: pctColor(totalPct) }}>{totalPct}%</p>
              <div className="w-full bg-gray-100 rounded-full h-2 mt-2">
                <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(totalPct, 100)}%`, backgroundColor: pctColor(totalPct) }} />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-medium text-gray-500 uppercase">Current Month ({MONTHS[CURRENT_MONTH - 1]})</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{fmt(curMonthActual)} / {fmt(curMonthBudget)}</p>
              <p className="text-sm font-semibold mt-0.5" style={{ color: pctColor(curMonthPct) }}>{curMonthPct}%</p>
              <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
                <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(curMonthPct, 100)}%`, backgroundColor: pctColor(curMonthPct) }} />
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">{CATEGORY_LABELS[category]} Budget vs Actual — {year}</h2>
            <div style={{ height: 360 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ left: 10, right: 30, top: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tickFormatter={fmtCompact} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 150]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value, name) => name === 'Achievement %' ? `${value}%` : fmt(Number(value))} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="Budget" fill="#94a3b8" radius={[2, 2, 0, 0]} barSize={20} />
                  <Bar yAxisId="left" dataKey="Actual" fill="#1a4731" radius={[2, 2, 0, 0]} barSize={20} />
                  <Line yAxisId="right" type="monotone" dataKey="Achievement %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: '#f59e0b' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Monthly Detail Table */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Monthly Detail</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 font-medium text-gray-500 text-xs uppercase">Month</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500 text-xs uppercase">Budget</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500 text-xs uppercase">Actual</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500 text-xs uppercase">Achievement</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500 text-xs uppercase">vs Last Year</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500 text-xs uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {MONTHS.map((m, i) => {
                  const mo = i + 1;
                  const bgt = getBudgetAmount(budgets, mo);
                  const act = monthlyActuals[i];
                  const pct = bgt > 0 ? Math.round((act / bgt) * 100) : 0;
                  const ly = lastYearActuals[i];
                  const lyDiff = ly > 0 ? Math.round(((act - ly) / ly) * 100) : null;
                  const hasData = act > 0;
                  const badge = statusBadge(pct, hasData);
                  const isCurrent = mo === CURRENT_MONTH && year === CURRENT_YEAR;

                  return (
                    <React.Fragment key={mo}>
                    <tr onClick={() => setExpandedMonth(expandedMonth === mo ? null : mo)}
                      className={`border-b border-gray-50 cursor-pointer transition-colors ${expandedMonth === mo ? 'bg-green-50/40' : isCurrent ? 'bg-green-50/20' : 'hover:bg-gray-50/60'}`}>
                      <td className="px-5 py-3 font-medium text-gray-900">
                        <span className="inline-flex items-center gap-2">
                          <span className={`text-xs text-gray-400 transition-transform ${expandedMonth === mo ? 'rotate-90' : ''}`} style={{ display: 'inline-block' }}>▶</span>
                          {m}{isCurrent && <span className="ml-1 text-xs text-green-600">(current)</span>}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {editingMonth === mo && category !== 'all' ? (
                          <input type="text" value={editValue} autoFocus
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineEdit(mo)}
                            onKeyDown={(e) => e.key === 'Enter' && saveInlineEdit(mo)}
                            className="w-24 text-right border border-green-400 rounded px-2 py-0.5 text-sm focus:outline-none"
                          />
                        ) : (
                          <span
                            className={`font-medium text-gray-700 ${category !== 'all' && isAdmin ? 'cursor-pointer hover:text-green-700' : ''}`}
                            onClick={() => { if (category !== 'all' && isAdmin) { setEditingMonth(mo); setEditValue(String(bgt)); } }}
                          >
                            {fmt(bgt)}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-medium" style={{ color: '#1a4731' }}>{hasData ? fmt(act) : '—'}</td>
                      <td className="px-5 py-3 text-right">
                        <span className="font-semibold" style={{ color: hasData ? pctColor(pct) : '#9ca3af' }}>{hasData ? `${pct}%` : '—'}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {lyDiff !== null ? (
                          <span className={lyDiff >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {lyDiff >= 0 ? '↑' : '↓'} {Math.abs(lyDiff)}%
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                      </td>
                    </tr>
                    {expandedMonth === mo && (
                      <tr><td colSpan={6} className="p-0 bg-gray-50/30">
                        <AccountBreakdown month={mo} year={year} category={category} salesData={salesData} />
                      </td></tr>
                    )}
                    </React.Fragment>
                  );
                })}
                {/* Total row */}
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-5 py-3 text-gray-900">TOTAL</td>
                  <td className="px-5 py-3 text-right text-gray-700">{fmt(totalBudget)}</td>
                  <td className="px-5 py-3 text-right" style={{ color: '#1a4731' }}>{fmt(totalActual)}</td>
                  <td className="px-5 py-3 text-right" style={{ color: pctColor(totalPct) }}>{totalPct}%</td>
                  <td className="px-5 py-3 text-right text-gray-400">—</td>
                  <td className="px-5 py-3"></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Category Breakdown (only for 'all') */}
          {category === 'all' && categoryBreakdown.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              {categoryBreakdown.map((cb) => (
                <div key={cb.category} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-gray-900 capitalize mb-3">{cb.category}</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Budget</span><span className="font-medium">{fmt(cb.budget)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Actual</span><span className="font-medium" style={{ color: '#1a4731' }}>{fmt(cb.actual)}</span></div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="h-2 rounded-full" style={{ width: `${Math.min(cb.pct, 100)}%`, backgroundColor: pctColor(cb.pct) }} />
                    </div>
                    <div className="flex justify-between"><span className="text-gray-500">Achievement</span><span className="font-semibold" style={{ color: pctColor(cb.pct) }}>{cb.pct}%</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Top Product</span><span className="text-xs text-gray-700 truncate max-w-[120px]">{cb.topProduct}</span></div>
                  </div>
                  <Link href={`/sales-dashboard/${cb.category}`} className="block mt-3 text-xs font-medium hover:underline" style={{ color: '#1a4731' }}>
                    View Details →
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* Top Accounts */}
          {topAccounts.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">Top Accounts — {year}</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="w-12 text-center px-3 py-3 font-medium text-gray-500 text-xs">#</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase">Account</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase">Category</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase">Total Sales</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase">% of Total</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {topAccounts.map((a, i) => {
                    const trend = a.lastYear > 0 ? Math.round(((a.amount - a.lastYear) / a.lastYear) * 100) : null;
                    return (
                      <tr key={a.name} className="border-b border-gray-50">
                        <td className="text-center px-3 py-3 text-gray-400 text-xs">{i + 1}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{a.name}</td>
                        <td className="px-4 py-3"><span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600 capitalize">{a.category}</span></td>
                        <td className="px-4 py-3 text-right font-medium" style={{ color: '#1a4731' }}>{fmt(a.amount)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{a.pctOfTotal}%</td>
                        <td className="px-4 py-3 text-right">
                          {trend !== null ? (
                            <span className={trend >= 0 ? 'text-green-600' : 'text-red-600'}>{trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%</span>
                          ) : <span className="text-gray-400">—</span>}
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

      {/* Set Annual Budget Modal */}
      {showBudgetModal && (
        <BudgetModal year={year} category={category} onClose={() => setShowBudgetModal(false)}
          onSave={() => { loadBudgets(); setToast(`Budget saved for ${CATEGORY_LABELS[category]} ${year}`); setShowBudgetModal(false); }} />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

// ── Budget Modal Component ──────────────────────────────────────────────────

function BudgetModal({ year: initialYear, category, onClose, onSave }: {
  year: number; category: BudgetCategory; onClose: () => void; onSave: () => void;
}) {
  const [year, setYear] = useState(initialYear);
  const [amounts, setAmounts] = useState<number[]>(new Array(12).fill(0));
  const [uniformVal, setUniformVal] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getBudgets(year, category).then((b) => {
      const vals = new Array(12).fill(0);
      b.forEach((e) => { if (e.month >= 1 && e.month <= 12) vals[e.month - 1] = e.budgetAmount; });
      setAmounts(vals);
    });
  }, [year, category]);

  function applyUniform() {
    const val = parseInt(uniformVal.replace(/,/g, '')) || 0;
    setAmounts(new Array(12).fill(val));
  }

  async function copyLastYear() {
    const b = await getBudgets(year - 1, category);
    const vals = new Array(12).fill(0);
    b.forEach((e) => { if (e.month >= 1 && e.month <= 12) vals[e.month - 1] = e.budgetAmount; });
    setAmounts(vals);
  }

  async function handleSave() {
    setSaving(true);
    await setBudgetBulk(year, category, amounts);
    setSaving(false);
    onSave();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Set {CATEGORY_LABELS[category]} Budget</h2>

        <div className="flex items-center gap-3 mb-5">
          <label className="text-sm font-medium text-gray-700">Year:</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          {MONTH_FULL.map((m, i) => (
            <div key={m} className="flex items-center gap-2">
              <label className="text-sm text-gray-600 w-24 flex-shrink-0">{m}</label>
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input type="text" value={amounts[i] ? amounts[i].toLocaleString() : ''}
                  onChange={(e) => { const v = [...amounts]; v[i] = parseInt(e.target.value.replace(/,/g, '')) || 0; setAmounts(v); }}
                  placeholder="0"
                  className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mb-5 p-3 bg-gray-50 rounded-lg">
          <input type="text" value={uniformVal} onChange={(e) => setUniformVal(e.target.value)} placeholder="Amount"
            className="w-32 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <button onClick={applyUniform} className="text-sm font-medium text-green-700 hover:underline">Apply to all months</button>
          <span className="text-gray-300">|</span>
          <button onClick={copyLastYear} className="text-sm font-medium text-blue-600 hover:underline">Copy from {year - 1}</button>
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#1a4731' }}>
            {saving ? 'Saving...' : 'Save Budget'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Account Breakdown Component ─────────────────────────────────────────────

const CAT_BADGE: Record<string, { bg: string; color: string }> = {
  monogastrics: { bg: '#E6F1FB', color: '#185FA5' },
  ruminants: { bg: '#E1F5EE', color: '#0F6E56' },
  latam: { bg: '#FAEEDA', color: '#854F0B' },
  familyb2b: { bg: '#EEEDFE', color: '#534AB7' },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AccountBreakdown({ month, year, category, salesData }: { month: number; year: number; category: string; salesData: any[] }) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monthRecords = salesData.filter((r: any) => r.date?.startsWith(prefix) && (category === 'all' || r.category === category));

  // Group by account → product
  const byAccount: Record<string, { name: string; totalAmount: number; cat: string; products: Record<string, { name: string; amount: number; volumeKg: number }> }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  monthRecords.forEach((r: any) => {
    const acct = r.account_name || r.accountName || 'Unknown';
    const prod = r.product_name || r.productName || 'Unknown';
    const amt = Number(r.amount) || 0;
    const vol = Number(r.volume_kg || r.volumeKg) || 0;
    if (!byAccount[acct]) byAccount[acct] = { name: acct, totalAmount: 0, cat: r.category || '', products: {} };
    byAccount[acct].totalAmount += amt;
    if (!byAccount[acct].products[prod]) byAccount[acct].products[prod] = { name: prod, amount: 0, volumeKg: 0 };
    byAccount[acct].products[prod].amount += amt;
    byAccount[acct].products[prod].volumeKg += vol;
  });

  const sorted = Object.values(byAccount).sort((a, b) => b.totalAmount - a.totalAmount);
  const grandTotal = sorted.reduce((s, a) => s + a.totalAmount, 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalVol = monthRecords.reduce((s: number, r: any) => s + (Number(r.volume_kg || r.volumeKg) || 0), 0);
  const showCat = category === 'all';

  if (sorted.length === 0) return <div className="px-10 py-4 text-sm text-gray-400">No sales records for this month.</div>;

  return (
    <div className="px-4 py-3 pl-10">
      <p className="text-xs font-medium mb-2" style={{ color: '#1a4731' }}>Account Breakdown — {sorted.length} accounts</p>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead><tr className="border-b border-gray-200">
          {showCat && <th className="text-left p-2 text-gray-500 font-medium">Cat.</th>}
          <th className="text-left p-2 text-gray-500 font-medium">Account</th>
          <th className="text-left p-2 text-gray-500 font-medium">Product</th>
          <th className="text-right p-2 text-gray-500 font-medium">Volume (KG)</th>
          <th className="text-right p-2 text-gray-500 font-medium">Amount</th>
          <th className="text-right p-2 text-gray-500 font-medium">% of Month</th>
        </tr></thead>
        <tbody>
          {sorted.map((acct, accIdx) => {
            const prods = Object.values(acct.products).sort((a, b) => b.amount - a.amount);
            const pct = grandTotal > 0 ? ((acct.totalAmount / grandTotal) * 100).toFixed(1) : '0';
            const badge = CAT_BADGE[acct.cat] || { bg: '#F1EFE8', color: '#5F5E5A' };
            return prods.map((prod, pIdx) => {
              const isFirst = pIdx === 0;
              const rowCount = prods.length;
              return (
                <tr key={`${acct.name}-${prod.name}`} className={accIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} style={{ borderBottom: pIdx === rowCount - 1 ? '1px solid #e5e7eb' : '0.5px solid #f3f4f6' }}>
                  {showCat && isFirst && <td rowSpan={rowCount} className="p-2 align-top"><span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: badge.bg, color: badge.color }}>{acct.cat}</span></td>}
                  {isFirst && <td rowSpan={rowCount} className="p-2 align-top font-semibold" style={{ color: '#1a4731', borderRight: '0.5px solid #e5e7eb' }}>{acct.name}<div className="text-[10px] text-gray-400 font-normal mt-0.5">${Math.round(acct.totalAmount).toLocaleString()} total</div></td>}
                  <td className="p-2 text-gray-700">{prod.name}</td>
                  <td className="p-2 text-right text-gray-500">{prod.volumeKg > 0 ? Math.round(prod.volumeKg).toLocaleString() + ' kg' : '—'}</td>
                  <td className="p-2 text-right font-medium">${Math.round(prod.amount).toLocaleString()}</td>
                  {isFirst && <td rowSpan={rowCount} className="p-2 text-right align-middle">
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(Number(pct), 100)}%`, backgroundColor: '#1a4731' }} /></div>
                      <span className="text-gray-500 min-w-[30px] text-right">{pct}%</span>
                    </div>
                  </td>}
                </tr>
              );
            });
          })}
        </tbody>
        <tfoot><tr className="border-t border-gray-200" style={{ backgroundColor: '#f0f7ee' }}>
          {showCat && <td className="p-2"></td>}
          <td className="p-2 font-semibold" style={{ color: '#1a4731' }}>Total ({sorted.length} accounts)</td>
          <td className="p-2"></td>
          <td className="p-2 text-right text-gray-600 font-medium">{Math.round(totalVol).toLocaleString()} kg</td>
          <td className="p-2 text-right font-semibold" style={{ color: '#1a4731' }}>${Math.round(grandTotal).toLocaleString()}</td>
          <td className="p-2 text-right font-medium" style={{ color: '#1a4731' }}>100%</td>
        </tr></tfoot>
      </table>
    </div>
  );
}
