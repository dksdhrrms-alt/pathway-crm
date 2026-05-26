'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import TopBar from '@/app/components/TopBar';
import { useCRM } from '@/lib/CRMContext';
import { SalesCategory } from '@/lib/excelParser';

import { CATEGORY_BADGE, CATEGORY_LABELS } from '@/lib/excelParser';

type Tab = 'all' | 'monogastrics' | 'ruminants' | 'latam' | 'familyb2b';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

const tabLabels: Record<Tab, string> = {
  all: 'All Sales',
  monogastrics: 'Monogastrics',
  ruminants: 'Ruminants',
  latam: 'LATAM',
  familyb2b: 'Family / B2B',
};

export default function SalesPage() {
  const { data: session } = useSession();
  const isAdmin = ['administrative_manager','admin','ceo','sales_director','coo'].includes(session?.user?.role ?? '');

  const { saleRecords: salesData } = useCRM();
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  // Sort state — column header click toggles asc/desc.
  type SortKey = 'date' | 'amount' | 'account';
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Page-based "show more" — initial 50 rows, +50 per click.
  const PAGE_STEP = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);

  const filtered = useMemo(() => {
    let data = salesData;
    if (activeTab !== 'all') data = data.filter((r) => r.category === activeTab);
    if (search) {
      const q = search.toLowerCase();
      data = data.filter((r) =>
        r.accountName.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        r.ownerName.toLowerCase().includes(q)
      );
    }
    const sorted = [...data].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'date') cmp = a.date.localeCompare(b.date);
      else if (sortKey === 'amount') cmp = a.amount - b.amount;
      else cmp = a.accountName.localeCompare(b.accountName);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [salesData, activeTab, search, sortKey, sortDir]);

  // Reset paging when filter/search/sort changes so users see fresh top results.
  useEffect(() => { setVisibleCount(PAGE_STEP); }, [activeTab, search, sortKey, sortDir]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;
  const totalAmount = filtered.reduce((s, r) => s + r.amount, 0);
  const totalVolume = filtered.reduce((s, r) => s + r.volumeKg, 0);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'date' || key === 'amount' ? 'desc' : 'asc'); }
  }
  function sortArrow(key: SortKey) {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  const tabs: Tab[] = ['all', 'monogastrics', 'ruminants', 'latam', 'familyb2b'];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Sales</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {filtered.length.toLocaleString()} record{filtered.length === 1 ? '' : 's'}
                {filtered.length !== salesData.length && <span className="text-gray-400 dark:text-gray-500"> of {salesData.length.toLocaleString()}</span>}
                {' '}· {formatCurrency(totalAmount)} total
              </p>
            </div>
            <div className="flex gap-2">
              {isAdmin && (
                <Link
                  href="/sales/upload"
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: '#1a4731' }}
                >
                  Upload Sales Data
                </Link>
              )}
            </div>
          </div>

          {salesData.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-16 text-center">
              <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-500 dark:text-gray-400 mb-2">No sales data yet</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">Upload an Excel file to populate the sales dashboard</p>
              {isAdmin && (
                <Link
                  href="/sales/upload"
                  className="inline-flex px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90"
                  style={{ backgroundColor: '#1a4731' }}
                >
                  Upload Sales Data
                </Link>
              )}
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Revenue</p>
                  <p className="text-2xl font-bold mt-1" style={{ color: '#1a4731' }}>{formatCurrency(totalAmount)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Volume</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{totalVolume.toLocaleString()} KG</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Records</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{filtered.length.toLocaleString()}</p>
                </div>
              </div>

              {/* Tabs + Search */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex gap-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg p-1">
                  {tabs.map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1.5 text-sm font-medium rounded transition-all ${
                        activeTab === tab ? 'text-white shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-200'
                      }`}
                      style={activeTab === tab ? { backgroundColor: '#1a4731' } : {}}
                    >
                      {tabLabels[tab]}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search accounts, products..."
                  className="border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-64"
                />
              </div>

              {/* Table */}
              <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
                      <th onClick={() => toggleSort('date')} className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200">Date{sortArrow('date')}</th>
                      <th onClick={() => toggleSort('account')} className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200">Account{sortArrow('account')}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs">Product</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs">PO#</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs">KG</th>
                      <th onClick={() => toggleSort('amount')} className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200">Amount{sortArrow('amount')}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs">Category</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs">Payment</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs">Rep</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r, i) => (
                      <tr key={r.id || i} className="border-b border-gray-50 dark:border-slate-800 hover:bg-gray-50/50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{r.date}</td>
                        <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{r.accountName}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{r.productName}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{r.poNumber}</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{r.volumeKg.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-gray-100">{formatCurrency(r.amount)}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: CATEGORY_BADGE[r.category]?.bg, color: CATEGORY_BADGE[r.category]?.text }}>
                            {CATEGORY_LABELS[r.category] || r.category}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs ${r.paymentStatus?.toLowerCase() === 'paid' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {r.paymentStatus || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{r.ownerName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {hasMore && (
                  <div className="px-4 py-3 flex items-center justify-center gap-3 text-xs border-t border-gray-100 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-800/40">
                    <span className="text-gray-500 dark:text-gray-400">
                      Showing <span className="font-medium text-gray-700 dark:text-gray-200">{visible.length.toLocaleString()}</span> of <span className="font-medium text-gray-700 dark:text-gray-200">{filtered.length.toLocaleString()}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setVisibleCount((n) => n + PAGE_STEP)}
                      className="px-3 py-1.5 text-xs font-medium text-white rounded-md hover:opacity-90"
                      style={{ backgroundColor: '#1a4731' }}
                    >
                      Show {Math.min(PAGE_STEP, filtered.length - visibleCount)} more
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibleCount(filtered.length)}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-slate-700 rounded-md hover:bg-gray-200 dark:hover:bg-slate-600"
                    >
                      Show all ({filtered.length.toLocaleString()})
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
