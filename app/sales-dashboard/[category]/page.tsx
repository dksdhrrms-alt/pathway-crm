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
import { getBudgets, setBudget, setBudgetBulk, getBudgetAmount, budgetsFromRaw, BudgetEntry, BudgetCategory } from '@/lib/budgetStore';
import { useCRM } from '@/lib/CRMContext';
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

  const { saleRecords: salesData, salesBudgets: ctxBudgets, accountBudgets, setAccountBudgets, accounts: crmAccounts } = useCRM();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [quarterFilter, setQuarterFilter] = useState<'all' | 'q1' | 'q2' | 'q3' | 'q4' | 'ytd'>('all');
  const [budgets, setBudgets] = useState<BudgetEntry[]>([]);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showAcctBudgetModal, setShowAcctBudgetModal] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingMonth, setEditingMonth] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  // Load data — try Supabase first, fall back to CRMContext salesBudgets
  const loadBudgets = useCallback(async () => {
    if (category === 'all') {
      const [m, r, l, f] = await Promise.all([
        getBudgets(year, 'monogastrics'), getBudgets(year, 'ruminants'), getBudgets(year, 'latam'), getBudgets(year, 'familyb2b'),
      ]);
      // If Supabase returned empty, try CRMContext raw budgets
      const mFinal = m.length > 0 ? m : budgetsFromRaw(ctxBudgets, year, 'monogastrics');
      const rFinal = r.length > 0 ? r : budgetsFromRaw(ctxBudgets, year, 'ruminants');
      const lFinal = l.length > 0 ? l : budgetsFromRaw(ctxBudgets, year, 'latam');
      const fFinal = f.length > 0 ? f : budgetsFromRaw(ctxBudgets, year, 'familyb2b');

      const combined: BudgetEntry[] = [];
      for (let mo = 1; mo <= 12; mo++) {
        combined.push({
          id: `all-${year}-${mo}`, year, month: mo, category: 'all',
          budgetAmount: getBudgetAmount(mFinal, mo) + getBudgetAmount(rFinal, mo) + getBudgetAmount(lFinal, mo) + getBudgetAmount(fFinal, mo),
        });
      }
      setBudgets(combined);
    } else {
      const result = await getBudgets(year, category);
      // Fallback to CRMContext if Supabase returned nothing
      if (result.length > 0) {
        setBudgets(result);
      } else {
        const fromCtx = budgetsFromRaw(ctxBudgets, year, category);
        setBudgets(fromCtx);
      }
    }
  }, [year, category, ctxBudgets]);

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

  // Quarter filter — which months to include
  const visibleMonths = useMemo(() => {
    if (quarterFilter === 'all') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    if (quarterFilter === 'q1') return [1, 2, 3];
    if (quarterFilter === 'q2') return [4, 5, 6];
    if (quarterFilter === 'q3') return [7, 8, 9];
    if (quarterFilter === 'q4') return [10, 11, 12];
    if (quarterFilter === 'ytd') return Array.from({ length: CURRENT_MONTH }, (_, i) => i + 1);
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }, [quarterFilter]);

  // Chart data
  const chartData = useMemo(() => {
    return MONTHS.map((m, i) => {
      const mo = i + 1;
      if (!visibleMonths.includes(mo)) return null;
      const budget = getBudgetAmount(budgets, mo);
      const actual = monthlyActuals[i];
      const pct = budget > 0 ? Math.round((actual / budget) * 100) : 0;
      return { month: m, Budget: budget, Actual: actual, 'Achievement %': pct };
    }).filter(Boolean) as { month: string; Budget: number; Actual: number; 'Achievement %': number }[];
  }, [budgets, monthlyActuals, visibleMonths]);

  // Totals — respect quarter filter
  const totalBudget = budgets.filter((b) => visibleMonths.includes(b.month)).reduce((s, b) => s + b.budgetAmount, 0);
  const totalActual = visibleMonths.reduce((s, mo) => s + monthlyActuals[mo - 1], 0);
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

  // Top accounts — roll up child account sales to their parent (Integration).
  // Accounts with companyType-set Distributors and other children get attributed to
  // the top-level parent, with a badge to indicate the totals include children.
  const topAccounts = useMemo(() => {
    const curMonth = CURRENT_MONTH;

    // Build accountName → parentAccountName map (case-insensitive lookup via lowercase keys)
    const acctByLowerName: Record<string, typeof crmAccounts[number]> = {};
    crmAccounts.forEach((a) => { acctByLowerName[a.name.toLowerCase()] = a; });
    function resolveParent(rawName: string): { rolledName: string; isParentRollup: boolean; sourceWasChild: boolean } {
      const found = acctByLowerName[rawName.toLowerCase()];
      if (!found || !found.parentAccountId) return { rolledName: rawName, isParentRollup: false, sourceWasChild: false };
      const parent = crmAccounts.find((p) => p.id === found.parentAccountId);
      if (!parent) return { rolledName: rawName, isParentRollup: false, sourceWasChild: false };
      return { rolledName: parent.name, isParentRollup: true, sourceWasChild: true };
    }

    // Track per rolled-up account: whether it's an integration parent + child contributors
    const accts: Record<string, { amount: number; category: string; lastYear: number; isIntegration: boolean; childContributors: Set<string> }> = {};

    for (const r of salesData) {
      const d = String(r.date || '').split('-');
      const rYear = parseInt(d[0]);
      if (rYear !== year) continue;
      if (category !== 'all' && r.category !== category) continue;
      const { rolledName, sourceWasChild } = resolveParent(r.accountName);
      if (!accts[rolledName]) accts[rolledName] = { amount: 0, category: r.category, lastYear: 0, isIntegration: false, childContributors: new Set() };
      accts[rolledName].amount += r.amount;
      if (sourceWasChild) {
        accts[rolledName].isIntegration = true;
        accts[rolledName].childContributors.add(r.accountName);
      }
    }
    // Compare same period (Jan through current month) of previous year
    for (const r of salesData) {
      const d = String(r.date || '').split('-');
      const rYear = parseInt(d[0]); const rMonth = parseInt(d[1]);
      if (rYear !== year - 1) continue;
      if (year === CURRENT_YEAR && rMonth > curMonth) continue; // same period only
      if (category !== 'all' && r.category !== category) continue;
      const { rolledName } = resolveParent(r.accountName);
      if (accts[rolledName]) accts[rolledName].lastYear += r.amount;
    }
    return Object.entries(accts)
      .map(([name, d]) => ({
        name,
        amount: d.amount,
        category: d.category,
        lastYear: d.lastYear,
        isIntegration: d.isIntegration,
        childCount: d.childContributors.size,
        pctOfTotal: totalActual > 0 ? Math.round((d.amount / totalActual) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
  }, [salesData, year, category, totalActual, crmAccounts]);

  // Build a product × month breakdown for an expanded account, including its
  // children (Integration roll-up). Returns sorted product list with monthly
  // amounts (12 entries) + total.
  const productBreakdownByAccount = useMemo(() => {
    const map: Record<string, { name: string; monthly: number[]; total: number }[]> = {};

    // Pre-compute included raw account names per top account
    const includedNamesByTop: Record<string, Set<string>> = {};
    for (const top of topAccounts) {
      const set = new Set<string>([top.name.toLowerCase()]);
      crmAccounts.forEach((a) => {
        if (!a.parentAccountId) return;
        const parent = crmAccounts.find((p) => p.id === a.parentAccountId);
        if (parent && parent.name.toLowerCase() === top.name.toLowerCase()) {
          set.add(a.name.toLowerCase());
        }
      });
      includedNamesByTop[top.name] = set;
    }

    for (const top of topAccounts) {
      const includedNames = includedNamesByTop[top.name];
      // product → 12-month amounts
      const matrix: Record<string, number[]> = {};
      for (const r of salesData) {
        if (!r.accountName || !includedNames.has(r.accountName.toLowerCase())) continue;
        const d = String(r.date || '').split('-');
        const rYear = parseInt(d[0]); const rMonth = parseInt(d[1]);
        if (rYear !== year) continue;
        if (category !== 'all' && r.category !== category) continue;
        if (!rMonth || rMonth < 1 || rMonth > 12) continue;
        const prod = r.productName || 'Unknown';
        if (!matrix[prod]) matrix[prod] = new Array(12).fill(0);
        matrix[prod][rMonth - 1] += Number(r.amount) || 0;
      }
      map[top.name] = Object.entries(matrix)
        .map(([name, monthly]) => ({ name, monthly, total: monthly.reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.total - a.total);
    }
    return map;
  }, [topAccounts, salesData, year, category, crmAccounts]);

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
              {/* Quarter filter */}
              <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
                {([['all', 'All'], ['q1', 'Q1'], ['q2', 'Q2'], ['q3', 'Q3'], ['q4', 'Q4'], ['ytd', 'YTD']] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setQuarterFilter(v)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${quarterFilter === v ? 'text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                    style={quarterFilter === v ? { backgroundColor: '#1a4731' } : {}}
                  >{l}</button>
                ))}
              </div>
              {isAdmin && category !== 'all' && (
                <>
                  <button onClick={() => setShowBudgetModal(true)}
                    className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                    Set Annual Budget
                  </button>
                  <button onClick={() => setShowAcctBudgetModal(true)}
                    className="px-4 py-2 text-sm font-medium rounded-lg hover:opacity-90"
                    style={{ backgroundColor: '#1a4731', color: 'white' }}>
                    Account Budgets
                  </button>
                </>
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
            <div className="chart-scroll-wrapper" style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <div style={{ minWidth: '500px', width: '100%', height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 10, right: 50, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tickFormatter={fmtCompact} width={55} tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 150]} tickFormatter={(v) => `${v}%`} width={45} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value, name) => name === 'Achievement %' ? `${value}%` : fmt(Number(value))} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="Budget" fill="#94a3b8" radius={[2, 2, 0, 0]} barSize={20} />
                    <Bar yAxisId="left" dataKey="Actual" fill="#1a4731" radius={[2, 2, 0, 0]} barSize={20} />
                    <Line yAxisId="right" type="monotone" dataKey="Achievement %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: '#f59e0b' }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Monthly Detail Table */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Monthly Detail</h2>
            </div>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="w-full text-sm" style={{ minWidth: '820px' }}>
              <thead>
                <tr className="border-b-2 border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase">Month</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase">Budget</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase">Actual</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase">Ach%</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase">vs LY</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase" style={{ borderLeft: '2px solid #e5e7eb' }}>YTD Budget</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase">YTD Actual</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase">YTD%</th>
                </tr>
              </thead>
              <tbody>
                {MONTHS.map((m, i) => {
                  const mo = i + 1;
                  if (!visibleMonths.includes(mo)) return null;
                  const bgt = getBudgetAmount(budgets, mo);
                  const act = monthlyActuals[i];
                  const pct = bgt > 0 ? Math.round((act / bgt) * 100) : 0;
                  const ly = lastYearActuals[i];
                  const lyDiff = ly > 0 ? Math.round(((act - ly) / ly) * 100) : null;
                  const hasData = act > 0;
                  const isCurrent = mo === CURRENT_MONTH && year === CURRENT_YEAR;
                  const isFuture = year === CURRENT_YEAR && mo > CURRENT_MONTH;

                  // YTD cumulative
                  const ytdBgt = budgets.filter((b) => b.month <= mo).reduce((s, b) => s + b.budgetAmount, 0);
                  const ytdAct = monthlyActuals.slice(0, mo).reduce((s, a) => s + a, 0);
                  const ytdPct = ytdBgt > 0 ? Math.round((ytdAct / ytdBgt) * 100) : 0;

                  return (
                    <React.Fragment key={mo}>
                    <tr onClick={() => setExpandedMonth(expandedMonth === mo ? null : mo)}
                      className={`border-b border-gray-50 cursor-pointer transition-colors ${expandedMonth === mo ? 'bg-green-50/40' : isCurrent ? 'bg-green-50/20' : 'hover:bg-gray-50/60'}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <span className="inline-flex items-center gap-2">
                          <span className={`text-xs text-gray-400 transition-transform ${expandedMonth === mo ? 'rotate-90' : ''}`} style={{ display: 'inline-block' }}>▶</span>
                          {m}{isCurrent && <span className="ml-1 text-xs text-green-600">(current)</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
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
                      <td className="px-4 py-3 text-right font-medium" style={{ color: isFuture ? '#ccc' : '#1a4731' }}>{hasData && !isFuture ? fmt(act) : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-semibold" style={{ color: hasData && !isFuture ? pctColor(pct) : '#9ca3af' }}>{hasData && !isFuture ? `${pct}%` : '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {lyDiff !== null && !isFuture ? (
                          <span style={{ color: lyDiff >= 0 ? '#0F6E56' : '#E24B4A', fontWeight: 500 }}>
                            {lyDiff >= 0 ? '↑' : '↓'}{Math.abs(lyDiff)}%
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700" style={{ borderLeft: '2px solid #e5e7eb', background: isCurrent ? '#f0f7ee' : '#fafafa' }}>
                        {ytdBgt > 0 && !isFuture ? fmt(ytdBgt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium" style={{ color: isFuture ? '#ccc' : '#1a4731', background: isCurrent ? '#f0f7ee' : '#fafafa' }}>
                        {ytdAct > 0 && !isFuture ? fmt(ytdAct) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right" style={{ background: isCurrent ? '#f0f7ee' : '#fafafa' }}>
                        <span className="font-semibold" style={{ color: ytdAct > 0 && !isFuture ? pctColor(ytdPct) : '#9ca3af' }}>{ytdAct > 0 && !isFuture ? `${ytdPct}%` : '—'}</span>
                      </td>
                    </tr>
                    {expandedMonth === mo && (
                      <tr><td colSpan={8} className="p-0 bg-gray-50/30">
                        <AccountBreakdown month={mo} year={year} category={category} salesData={salesData} />
                        <ManagerBreakdown month={mo} year={year} category={category} salesData={salesData} />
                      </td></tr>
                    )}
                    </React.Fragment>
                  );
                })}
                {/* Total row */}
                {(() => {
                  const ytdIdx = year === CURRENT_YEAR ? CURRENT_MONTH - 1 : 11;
                  const ytdBgt = budgets.filter((b) => b.month <= ytdIdx + 1).reduce((s, b) => s + b.budgetAmount, 0);
                  const ytdAct = monthlyActuals.slice(0, ytdIdx + 1).reduce((s, a) => s + a, 0);
                  const ytdPct = ytdBgt > 0 ? Math.round((ytdAct / ytdBgt) * 100) : 0;
                  return (
                    <tr style={{ background: '#1a4731', color: 'white', fontWeight: 600 }}>
                      <td className="px-4 py-3">TOTAL</td>
                      <td className="px-4 py-3 text-right">{fmt(totalBudget)}</td>
                      <td className="px-4 py-3 text-right">{fmt(totalActual)}</td>
                      <td className="px-4 py-3 text-right" style={{ color: totalPct >= 100 ? '#9FE1CB' : totalPct >= 80 ? '#FAC775' : '#F09595' }}>{totalPct}%</td>
                      <td className="px-4 py-3 text-right" style={{ opacity: 0.6 }}>—</td>
                      <td className="px-4 py-3 text-right" style={{ borderLeft: '2px solid rgba(255,255,255,0.2)' }}>{fmt(ytdBgt)}</td>
                      <td className="px-4 py-3 text-right">{fmt(ytdAct)}</td>
                      <td className="px-4 py-3 text-right" style={{ color: ytdPct >= 100 ? '#9FE1CB' : ytdPct >= 80 ? '#FAC775' : '#F09595' }}>{ytdPct}%</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
            </div>
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
                    <th className="text-right px-4 py-3 font-medium text-gray-500 text-xs uppercase">YoY</th>
                  </tr>
                </thead>
                <tbody>
                  {topAccounts.map((a, i) => {
                    const trend = a.lastYear > 0 ? Math.round(((a.amount - a.lastYear) / a.lastYear) * 100) : null;
                    const isOpen = expandedAccount === a.name;
                    const products = productBreakdownByAccount[a.name] || [];
                    return (
                      <React.Fragment key={a.name}>
                        <tr
                          onClick={() => setExpandedAccount(isOpen ? null : a.name)}
                          className={`border-b border-gray-50 cursor-pointer transition-colors ${isOpen ? 'bg-green-50/40' : 'hover:bg-gray-50/60'}`}
                        >
                          <td className="text-center px-3 py-3 text-gray-400 text-xs">
                            <span className="inline-flex items-center gap-1">
                              <span style={{ display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', fontSize: '9px' }}>▶</span>
                              {i + 1}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium">
                            <div className="flex items-center gap-2 flex-wrap">
                              {(() => { const match = crmAccounts.find((ac) => ac.name === a.name); return match ? (
                                <a href={`/accounts/${match.id}`} onClick={(e) => e.stopPropagation()} style={{ color: '#1a4731', textDecoration: 'none' }} className="hover:underline">{a.name}</a>
                              ) : <span className="text-gray-800">{a.name}</span>; })()}
                              {a.isIntegration && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-100" title={`Includes sales rolled up from ${a.childCount} child account${a.childCount > 1 ? 's' : ''}`}>
                                  ◆ Integration · +{a.childCount}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3"><span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600 capitalize">{a.category}</span></td>
                          <td className="px-4 py-3 text-right font-medium" style={{ color: '#1a4731' }}>{fmt(a.amount)}</td>
                          <td className="px-4 py-3 text-right text-gray-500">{a.pctOfTotal}%</td>
                          <td className="px-4 py-3 text-right">
                            {trend !== null ? (
                              <span className={trend >= 0 ? 'text-green-600' : 'text-red-600'}>{trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%</span>
                            ) : <span className="text-gray-400">—</span>}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-gray-100 bg-gray-50/40">
                            <td colSpan={6} className="p-0">
                              <div className="px-6 py-4">
                                <div className="flex items-center justify-between mb-3">
                                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Product × Month — {a.name} ({year})</p>
                                  {a.isIntegration && (
                                    <span className="text-[10px] text-blue-600">includes {a.childCount} child account{a.childCount > 1 ? 's' : ''}</span>
                                  )}
                                </div>
                                {products.length === 0 ? (
                                  <p className="text-sm text-gray-400 text-center py-4">No product data for this account in {year}.</p>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs border border-gray-200 rounded">
                                      <thead>
                                        <tr className="bg-white border-b border-gray-200">
                                          <th className="text-left px-3 py-2 font-medium text-gray-500 sticky left-0 bg-white z-10" style={{ minWidth: 200 }}>Product</th>
                                          {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m) => (
                                            <th key={m} className="text-right px-2 py-2 font-medium text-gray-500" style={{ minWidth: 70 }}>{m}</th>
                                          ))}
                                          <th className="text-right px-3 py-2 font-medium text-gray-700 bg-gray-100" style={{ minWidth: 90 }}>Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {products.map((p) => (
                                          <tr key={p.name} className="border-b border-gray-100 hover:bg-white">
                                            <td className="px-3 py-1.5 font-medium text-gray-800 sticky left-0 bg-gray-50/40 hover:bg-white z-10">{p.name}</td>
                                            {p.monthly.map((amt, mi) => (
                                              <td key={mi} className={`text-right px-2 py-1.5 ${amt > 0 ? 'text-gray-700' : 'text-gray-300'}`}>
                                                {amt > 0 ? fmt(amt) : '—'}
                                              </td>
                                            ))}
                                            <td className="text-right px-3 py-1.5 font-semibold bg-gray-50" style={{ color: '#1a4731' }}>{fmt(p.total)}</td>
                                          </tr>
                                        ))}
                                        {/* Monthly totals row */}
                                        <tr className="border-t-2 border-gray-300 bg-white">
                                          <td className="px-3 py-2 font-semibold text-gray-700 sticky left-0 bg-white z-10">TOTAL</td>
                                          {Array.from({ length: 12 }).map((_, mi) => {
                                            const monthTotal = products.reduce((s, p) => s + p.monthly[mi], 0);
                                            return (
                                              <td key={mi} className={`text-right px-2 py-2 font-semibold ${monthTotal > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                                                {monthTotal > 0 ? fmt(monthTotal) : '—'}
                                              </td>
                                            );
                                          })}
                                          <td className="text-right px-3 py-2 font-bold" style={{ color: '#1a4731', backgroundColor: '#e8f5e9' }}>{fmt(a.amount)}</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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

      {/* Account Budget Modal */}
      {showAcctBudgetModal && (
        <AcctBudgetModal year={year} category={category} salesData={salesData} accountBudgets={accountBudgets} setAccountBudgets={setAccountBudgets} crmAccounts={crmAccounts}
          onClose={() => setShowAcctBudgetModal(false)} onSaved={() => { setToast('Account budgets saved'); setShowAcctBudgetModal(false); }} />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

// ── Account Budget Modal ────────────────────────────────────────────────────

function AcctBudgetModal({ year, category, salesData, accountBudgets, setAccountBudgets, crmAccounts, onClose, onSaved }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  year: number; category: string; salesData: any[]; accountBudgets: import('@/lib/data').AccountBudget[];
  setAccountBudgets: React.Dispatch<React.SetStateAction<import('@/lib/data').AccountBudget[]>>;
  crmAccounts: import('@/lib/data').Account[]; onClose: () => void; onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [inputs, setInputs] = useState<Record<string, Record<number, string>>>({});

  // Merge accounts from 3 sources: sales records, existing budgets, CRM accounts
  const CAT_INDUSTRIES: Record<string, string[]> = {
    monogastrics: ['poultry', 'swine'], ruminants: ['beef', 'dairy', 'ruminant'],
    latam: ['latam', 'distributor'], familyb2b: ['family', 'b2b', 'distribution', 'feed mill'],
  };
  const salesNames = [...new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    salesData.filter((r: any) => category === 'all' || r.category === category)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => r.account_name || r.accountName || '').filter(Boolean),
  )];
  const budgetNames = [...new Set(
    accountBudgets.filter((b) => category === 'all' || b.category === category).map((b) => b.accountName).filter(Boolean),
  )];
  const crmNames = crmAccounts
    .filter((a) => {
      if (category === 'all') return true;
      const kws = CAT_INDUSTRIES[category] || [];
      return kws.some((k) => (a.industry || '').toLowerCase().includes(k) || (a.category || '') === category);
    })
    .map((a) => a.name).filter(Boolean);
  const accounts = [...new Set([...salesNames, ...budgetNames, ...crmNames])].sort();

  useEffect(() => {
    const init: Record<string, Record<number, string>> = {};
    accounts.forEach((acct) => {
      init[acct] = {};
      for (let m = 1; m <= 12; m++) {
        const existing = accountBudgets.find((b) => b.accountName === acct && b.year === year && b.month === m);
        init[acct][m] = existing ? String(existing.budgetAmount) : '';
      }
    });
    setInputs(init);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length, year]);

  async function handleSave() {
    setSaving(true);
    try {
      const { dbUpsertAccountBudget, dbGetAccountBudgets } = await import('@/lib/db');
      const promises: Promise<void>[] = [];
      Object.entries(inputs).forEach(([acct, months]) => {
        Object.entries(months).forEach(([mo, val]) => {
          const amount = parseFloat(val) || 0;
          if (amount > 0) promises.push(dbUpsertAccountBudget(acct, year, parseInt(mo), amount, category));
        });
      });
      await Promise.all(promises);
      const fresh = await dbGetAccountBudgets();
      setAccountBudgets(fresh);
      onSaved();
    } catch (err) { console.error('Save account budgets error:', err); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '950px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Account Budgets - {year}</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>Set monthly budget targets per account ({accounts.length} accounts)</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#888' }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px' }}>
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '800px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#888', fontWeight: 500, position: 'sticky', top: 0, background: 'white', minWidth: '140px' }}>Account</th>
                {MONTHS.map((m, i) => <th key={i} style={{ padding: '8px 2px', textAlign: 'center', color: '#888', fontWeight: 500, position: 'sticky', top: 0, background: 'white', minWidth: '56px' }}>{m}</th>)}
                <th style={{ padding: '8px 10px', textAlign: 'right', color: '#888', fontWeight: 500, position: 'sticky', top: 0, background: 'white' }}>Annual</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acct, idx) => {
                const annual = Object.values(inputs[acct] || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
                return (
                  <tr key={acct} style={{ borderBottom: '0.5px solid #f3f4f6', background: idx % 2 === 0 ? 'white' : '#fafafa' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 500, fontSize: '11px' }}>{acct}</td>
                    {MONTHS.map((_, i) => {
                      const mo = i + 1;
                      const val = inputs[acct]?.[mo] || '';
                      return (
                        <td key={i} style={{ padding: '3px 2px' }}>
                          <input type="number" value={val} placeholder="0"
                            onChange={(e) => setInputs((p) => ({ ...p, [acct]: { ...(p[acct] || {}), [mo]: e.target.value } }))}
                            style={{ width: '54px', padding: '3px 4px', fontSize: '11px', border: val ? '1px solid #1a4731' : '1px solid #e5e7eb', borderRadius: '4px', textAlign: 'right', background: val ? '#f0f7ee' : 'white' }}
                          />
                        </td>
                      );
                    })}
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontSize: '11px', color: annual > 0 ? '#1a4731' : '#ccc' }}>
                      {annual > 0 ? '$' + Math.round(annual).toLocaleString() : '--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
        {/* Totals bar — fixed above footer */}
        <div style={{ padding: '10px 16px', background: '#f0f7ee', borderTop: '2px solid #1a4731', borderBottom: '0.5px solid #e5e7eb', flexShrink: 0, overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', minWidth: '800px' }}>
            <div style={{ width: '150px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: '#1a4731', padding: '0 10px' }}>Total Budget</div>
            {MONTHS.map((_, i) => {
              const mo = i + 1;
              const moTotal = accounts.reduce((s, acct) => s + (parseFloat(inputs[acct]?.[mo] || '') || 0), 0);
              return <div key={i} style={{ minWidth: '58px', padding: '0 2px', textAlign: 'center', fontSize: '11px', fontWeight: 600, color: moTotal > 0 ? '#1a4731' : '#aaa' }}>{moTotal > 0 ? '$' + Math.round(moTotal / 1000) + 'K' : '--'}</div>;
            })}
            <div style={{ marginLeft: 'auto', padding: '0 10px', fontSize: '13px', fontWeight: 700, color: '#1a4731', whiteSpace: 'nowrap' }}>
              {(() => { const gt = accounts.reduce((s, acct) => s + Object.values(inputs[acct] || {}).reduce((ss, v) => ss + (parseFloat(v) || 0), 0), 0); return gt > 0 ? '$' + Math.round(gt).toLocaleString() : '--'; })()}
            </div>
          </div>
        </div>
        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: '8px', border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: saving ? '#e5e7eb' : '#1a4731', color: saving ? '#888' : 'white', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 500 }}>
            {saving ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>
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

// ── Account Breakdown (by account + product) ────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AccountBreakdown({ month, year, category, salesData }: { month: number; year: number; category: string; salesData: any[] }) {
  const { accounts: crmAccts } = useCRM();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monthRecords = salesData.filter((r: any) => r.date?.startsWith(prefix) && (category === 'all' || r.category === category));

  const byAccount: Record<string, { name: string; totalAmount: number; products: Record<string, { name: string; amount: number; volumeKg: number }> }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  monthRecords.forEach((r: any) => {
    const acct = r.account_name || r.accountName || 'Unknown';
    const prod = r.product_name || r.productName || 'Unknown';
    const amt = Number(r.amount) || 0;
    const vol = Number(r.volume_kg || r.volumeKg) || 0;
    if (!byAccount[acct]) byAccount[acct] = { name: acct, totalAmount: 0, products: {} };
    byAccount[acct].totalAmount += amt;
    if (!byAccount[acct].products[prod]) byAccount[acct].products[prod] = { name: prod, amount: 0, volumeKg: 0 };
    byAccount[acct].products[prod].amount += amt;
    byAccount[acct].products[prod].volumeKg += vol;
  });

  const sorted = Object.values(byAccount).sort((a, b) => b.totalAmount - a.totalAmount);
  const grandTotal = sorted.reduce((s, a) => s + a.totalAmount, 0);

  if (sorted.length === 0) return <div className="px-10 py-4 text-sm text-gray-400">No sales records for this month.</div>;

  return (
    <div style={{ padding: '12px 16px 4px 40px' }}>
      <p style={{ fontSize: '12px', fontWeight: 600, color: '#1a4731', marginBottom: '8px' }}>Account Breakdown ({sorted.length} accounts)</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '5px 10px', color: '#888', fontWeight: 500 }}>Account</th>
            <th style={{ textAlign: 'left', padding: '5px 10px', color: '#888', fontWeight: 500 }}>Product</th>
            <th style={{ textAlign: 'right', padding: '5px 10px', color: '#888', fontWeight: 500 }}>Volume (KG)</th>
            <th style={{ textAlign: 'right', padding: '5px 10px', color: '#888', fontWeight: 500 }}>Amount</th>
            <th style={{ textAlign: 'right', padding: '5px 10px', color: '#888', fontWeight: 500 }}>%</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((acct, accIdx) => {
            const prods = Object.values(acct.products).sort((a, b) => b.amount - a.amount);
            const pct = grandTotal > 0 ? ((acct.totalAmount / grandTotal) * 100).toFixed(1) : '0';
            return prods.map((prod, pIdx) => (
              <tr key={`${acct.name}-${prod.name}`} style={{ borderBottom: pIdx === prods.length - 1 ? '1px solid #e5e7eb' : '0.5px solid #f3f4f6', background: accIdx % 2 === 0 ? 'white' : '#fafafa' }}>
                {pIdx === 0 && (
                  <td rowSpan={prods.length} style={{ padding: '8px 10px', fontWeight: 500, verticalAlign: 'top', borderRight: '0.5px solid #e5e7eb' }}>
                    {(() => { const match = crmAccts.find((a) => a.name === acct.name); return match ? (
                      <a href={`/accounts/${match.id}`} style={{ color: '#1a4731', textDecoration: 'none' }} onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }} onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}>{acct.name}</a>
                    ) : <span style={{ color: '#1a4731' }}>{acct.name}</span>; })()}
                    <div style={{ fontSize: '10px', color: '#888', fontWeight: 400, marginTop: '2px' }}>${Math.round(acct.totalAmount).toLocaleString()}</div>
                  </td>
                )}
                <td style={{ padding: '6px 10px', color: '#444' }}>{prod.name}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', color: '#666' }}>{prod.volumeKg > 0 ? Math.round(prod.volumeKg).toLocaleString() + ' kg' : '--'}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 500 }}>${Math.round(prod.amount).toLocaleString()}</td>
                {pIdx === 0 && (
                  <td rowSpan={prods.length} style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                    <span style={{ color: '#666', fontSize: '11px' }}>{pct}%</span>
                  </td>
                )}
              </tr>
            ));
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1px solid #e5e7eb', background: '#f0f7ee' }}>
            <td colSpan={3} style={{ padding: '6px 10px', fontWeight: 600, color: '#1a4731', fontSize: '11px' }}>Total ({sorted.length} accounts)</td>
            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: '#1a4731' }}>${Math.round(grandTotal).toLocaleString()}</td>
            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#1a4731' }}>100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Account Manager Breakdown ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ManagerBreakdown({ month, year, category, salesData }: { month: number; year: number; category: string; salesData: any[] }) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monthRecords = salesData.filter((r: any) => r.date?.startsWith(prefix) && (category === 'all' || r.category === category));

  // Group by account manager
  const byManager: Record<string, { managerName: string; amount: number; volumeKg: number }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  monthRecords.forEach((r: any) => {
    const mgr = r.owner_name || r.ownerName || 'Unassigned';
    const amt = Number(r.amount) || 0;
    const vol = Number(r.volume_kg || r.volumeKg) || 0;
    if (!byManager[mgr]) byManager[mgr] = { managerName: mgr, amount: 0, volumeKg: 0 };
    byManager[mgr].amount += amt;
    byManager[mgr].volumeKg += vol;
  });

  const sorted = Object.values(byManager).sort((a, b) => b.amount - a.amount);
  const totalAmount = sorted.reduce((s, m) => s + m.amount, 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalVol = monthRecords.reduce((s: number, r: any) => s + (Number(r.volume_kg || r.volumeKg) || 0), 0);

  if (sorted.length === 0) return <div className="px-10 py-4 text-sm text-gray-400">No sales records for this month.</div>;

  return (
    <div style={{ padding: '12px 16px 12px 40px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '6px 12px', color: '#888', fontWeight: 500, width: '35%' }}>Account Manager</th>
            <th style={{ textAlign: 'right', padding: '6px 12px', color: '#888', fontWeight: 500, width: '20%' }}>Volume (KG)</th>
            <th style={{ textAlign: 'right', padding: '6px 12px', color: '#888', fontWeight: 500, width: '25%' }}>Amount</th>
            <th style={{ textAlign: 'right', padding: '6px 12px', color: '#888', fontWeight: 500, width: '20%' }}>% of Month</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((mgr, idx) => {
            const pct = totalAmount > 0 ? ((mgr.amount / totalAmount) * 100).toFixed(1) : '0';
            return (
              <tr key={mgr.managerName} style={{ borderBottom: '0.5px solid #f3f4f6', background: idx % 2 === 0 ? 'white' : '#fafafa' }}>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '28px', height: '28px', borderRadius: '50%', background: '#1a4731',
                      color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '10px', fontWeight: 600, flexShrink: 0,
                    }}>
                      {mgr.managerName.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase()}
                    </div>
                    <span style={{ fontWeight: 500 }}>{mgr.managerName}</span>
                  </div>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: '#666', fontSize: '12px' }}>
                  {mgr.volumeKg > 0 ? Math.round(mgr.volumeKg).toLocaleString() + ' kg' : '--'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>
                  ${Math.round(mgr.amount).toLocaleString()}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                    <div style={{ width: '60px', height: '4px', background: '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(Number(pct), 100)}%`, height: '100%', background: '#1a4731', borderRadius: '2px' }} />
                    </div>
                    <span style={{ color: '#666', minWidth: '36px', textAlign: 'right', fontSize: '12px' }}>{pct}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1px solid #e5e7eb', background: '#E1F5EE' }}>
            <td style={{ padding: '8px 12px', fontWeight: 600, color: '#1a4731', fontSize: '12px' }}>Total ({sorted.length} managers)</td>
            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontSize: '12px', fontWeight: 500 }}>{Math.round(totalVol).toLocaleString()} kg</td>
            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#1a4731' }}>${Math.round(totalAmount).toLocaleString()}</td>
            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#1a4731', fontWeight: 600 }}>100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
