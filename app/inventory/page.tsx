'use client';

/**
 * Inventory landing page — Phase 1 (snapshot) + Phase 2 (forecast).
 *
 * Replaces the Monday board ("current stock per product × location")
 * AND the per-product Excel workbook ("monthly IN/OUT/Balance going
 * forward"). Schema lives in data-migration/20-inventory.sql.
 *
 * This first commit is the route + access guard + tab shell. The
 * actual grids are wired in follow-up commits so each piece can be
 * reviewed standalone:
 *
 *   1. Snapshot — group-by-product / group-by-location toggle, sum
 *      of in-stock + upcoming lots.
 *   2. Forecast — rolling 24-month IN / OUT / Balance per product ×
 *      location, with Best / Worst scenario toggle.
 *   3. Add-stock / Add-forecast modals.
 *
 * Access is restricted to admin tier (admin / administrative_manager
 * / ceo / coo) for now — operations folks. Sales reps don't need
 * write access; if they need read-only later we'll relax.
 */

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useState } from 'react';
import TopBar from '@/app/components/TopBar';

const ALLOWED_ROLES = ['admin', 'administrative_manager', 'ceo', 'coo'];

export default function InventoryPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const allowed = ALLOWED_ROLES.includes(role);

  const [tab, setTab] = useState<'snapshot' | 'forecast'>('snapshot');

  if (!allowed) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
        <TopBar placeholder="Search CRM..." />
        <main className="pt-16 px-6 pb-10">
          <div className="max-w-3xl mx-auto mt-12 text-center text-gray-600 dark:text-gray-400">
            <h1 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">Access denied</h1>
            <p>Inventory is restricted to operations / leadership roles.</p>
            <Link href="/dashboard" className="inline-block mt-4 text-emerald-700 dark:text-emerald-400 hover:underline">← Back to Home</Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar placeholder="Search CRM..." />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-5 flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Inventory</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Current stock by product × location, plus rolling forecast. Replaces the Monday board and the per-product planning Excel.
              </p>
            </div>
            <Link
              href="/inventory/settings"
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              Manage products / locations
            </Link>
          </div>

          {/* Tabs */}
          <div className="inline-flex bg-gray-100 dark:bg-slate-800 p-1 rounded-lg mb-5">
            <button
              onClick={() => setTab('snapshot')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                tab === 'snapshot'
                  ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Current stock
            </button>
            <button
              onClick={() => setTab('forecast')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                tab === 'forecast'
                  ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Forecast
            </button>
          </div>

          {/* Body — grids land in follow-up commits */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-8">
            {tab === 'snapshot' ? (
              <SnapshotPlaceholder />
            ) : (
              <ForecastPlaceholder />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function SnapshotPlaceholder() {
  return (
    <div className="text-center text-gray-500 dark:text-gray-400 py-8">
      <p className="text-base font-medium text-gray-700 dark:text-gray-200 mb-2">Current stock grid — coming next</p>
      <p className="text-sm">
        Apply <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400">data-migration/20-inventory.sql</code> in Supabase,
        then I&apos;ll wire up the product × location grid (like your Monday board) here.
      </p>
    </div>
  );
}


function ForecastPlaceholder() {
  return (
    <div className="text-center text-gray-500 dark:text-gray-400 py-8">
      <p className="text-base font-medium text-gray-700 dark:text-gray-200 mb-2">Forecast view — coming next</p>
      <p className="text-sm">
        Rolling 24-month IN / OUT / Balance per product × location, Best / Worst scenarios — same shape as your Excel planning workbook.
      </p>
    </div>
  );
}
