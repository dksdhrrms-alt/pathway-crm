'use client';

/**
 * /rnd — R&D yearly budget tracker.
 *
 * Layout (per the agreed mockup):
 *   - Title bar: 🔬 R&D + year selector.
 *   - Summary band: Annual budget · Spent · Remaining · Used %.
 *   - 12-card grid (Jan → Dec) — each card lists the year's R&D entries
 *     that landed in that month, plus an "Add R&D" button.
 *   - The current month is highlighted with a blue outline + "Current"
 *     pill so users always have an obvious "where am I now" anchor.
 *
 * Data:
 *   - rnd_budgets — one row per year (annual_amount).
 *   - rnd_expenses — individual entries, soft-deleted via archived_at.
 *
 * Permissions:
 *   - Anyone with the `rnd` menu permission can view + add expenses.
 *   - Editing the annual budget is gated to admin-ish roles
 *     (administrative_manager / admin / ceo). See `canEditBudget` below.
 *
 * No realtime subscription here for now — page is small enough that the
 * cost of a manual refresh after add/edit/delete is negligible, and
 * adding a `useEffect` channel.subscribe would duplicate work that the
 * CRMContext already does for the core tables.
 */

import { useEffect, useMemo, useState } from 'react';
import type { RndBudget, RndExpense } from '@/lib/data';
import { dbGetRndBudgets, dbGetRndExpenses } from '@/lib/db';
import TopBar from '@/app/components/TopBar';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import RndExpenseModal from '@/app/components/RndExpenseModal';
import RndBudgetModal from '@/app/components/RndBudgetModal';

const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export default function RndPage() {
  // No role gate: every authenticated user (already verified by the
  // middleware that gates /rnd) can view, add, edit, and delete entries
  // including the annual budget. If we later need stricter control, add
  // a `canEditBudget` check here and on the relevant buttons.

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-based to match RndExpense.month

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [budgets, setBudgets] = useState<RndBudget[]>([]);
  const [expenses, setExpenses] = useState<RndExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [expenseModal, setExpenseModal] = useState<
    | { mode: 'add'; year: number; month: number }
    | { mode: 'edit'; expense: RndExpense }
    | null
  >(null);

  // Reload data from Supabase. Called on mount, on year change, and
  // after any add/edit/delete so the UI reflects the latest state.
  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [b, e] = await Promise.all([dbGetRndBudgets(), dbGetRndExpenses()]);
      setBudgets(b);
      setExpenses(e);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('R&D load error:', msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  // Build the year picker options: anything that has data + the current
  // year + a few years around it. Always sorted desc so newest first.
  const yearOptions = useMemo(() => {
    const set = new Set<number>([currentYear, currentYear - 1, currentYear + 1]);
    for (const b of budgets) set.add(b.year);
    for (const e of expenses) set.add(e.year);
    return [...set].sort((a, b) => b - a);
  }, [budgets, expenses, currentYear]);

  // Year-scoped data — everything below uses these instead of raw arrays.
  const yearBudget = budgets.find((b) => b.year === selectedYear);
  const yearExpenses = useMemo(
    () => expenses.filter((e) => e.year === selectedYear),
    [expenses, selectedYear],
  );

  const annualBudget = yearBudget?.annualAmount ?? 0;
  const totalSpent = useMemo(
    () => yearExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [yearExpenses],
  );
  const remaining = annualBudget - totalSpent;
  const usedPct = annualBudget > 0 ? (totalSpent / annualBudget) * 100 : 0;

  // Group expenses by month for the 12-card grid. Empty months → empty arr.
  const byMonth = useMemo(() => {
    const m: Record<number, RndExpense[]> = {};
    for (let i = 1; i <= 12; i++) m[i] = [];
    for (const e of yearExpenses) {
      if (m[e.month]) m[e.month].push(e);
    }
    // Sort each month's entries: largest amount first, more recent first.
    for (const k of Object.keys(m)) {
      m[Number(k)].sort((a, b) => (b.amount || 0) - (a.amount || 0));
    }
    return m;
  }, [yearExpenses]);

  // ─────────────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────────────

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar placeholder="Search R&D..." />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">

          {/* Title bar */}
          <div className="mt-6 mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 3h6m-5 0v6.5L4 19a2 2 0 001.7 3h12.6a2 2 0 001.7-3L14 9.5V3" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 15h10" />
                </svg>
              </span>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">R&D</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">Annual budget tracker</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {/* Annual budget summary band */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm p-4 mb-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-center">
              <div>
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Annual budget — {selectedYear}</p>
                <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                  <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{fmtUSD(annualBudget)}</p>
                  <button
                    onClick={() => setBudgetModalOpen(true)}
                    className="text-xs px-2 py-0.5 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-slate-800"
                  >
                    {annualBudget > 0 ? 'Edit' : 'Set'}
                  </button>
                </div>
                {yearBudget?.notes && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic line-clamp-2" title={yearBudget.notes}>
                    {yearBudget.notes}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Spent</p>
                <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">{fmtUSD(totalSpent)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Remaining</p>
                <p className={`mt-1 text-xl font-semibold ${remaining >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                  {fmtUSD(remaining)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Used</p>
                <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">{usedPct.toFixed(0)}%</p>
                <div className="mt-2 h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${usedPct > 100 ? 'bg-red-500' : usedPct > 80 ? 'bg-amber-500' : 'bg-green-600'}`}
                    style={{ width: `${Math.min(usedPct, 100)}%` }}
                  />
                </div>
                {annualBudget === 0 && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Set a budget to see %</p>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              Failed to load: {error}
            </div>
          )}

          {/* 12-month grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {MONTH_LABELS.map((label, idx) => {
              const month = idx + 1;
              const entries = byMonth[month] || [];
              const monthTotal = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
              const isCurrent = selectedYear === currentYear && month === currentMonth;

              return (
                <div
                  key={month}
                  className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm p-3 transition-colors ${
                    isCurrent
                      ? 'border-2 border-blue-500 dark:border-blue-400'
                      : 'border border-gray-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-baseline justify-between mb-2">
                    <p className={`text-sm font-semibold ${entries.length === 0 ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>
                      {label}
                      {isCurrent && (
                        <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                          Current
                        </span>
                      )}
                    </p>
                    <p className={`text-sm font-medium tabular-nums ${entries.length === 0 ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>
                      {entries.length === 0 ? '—' : fmtUSD(monthTotal)}
                    </p>
                  </div>

                  {entries.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-slate-800 pt-2 mb-2">
                      No entries yet.
                    </p>
                  ) : (
                    <div className="text-xs space-y-0 border-t border-gray-100 dark:border-slate-800">
                      {entries.map((e) => (
                        <button
                          key={e.id}
                          onClick={() => setExpenseModal({ mode: 'edit', expense: e })}
                          className="w-full text-left py-1.5 border-b border-gray-100 dark:border-slate-800 last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-800/40 -mx-1 px-1 rounded transition-colors"
                          title="Click to edit"
                        >
                          <div className="flex justify-between gap-2">
                            <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{e.name}</span>
                            <span className="tabular-nums text-gray-600 dark:text-gray-300 flex-shrink-0">{fmtUSD(e.amount)}</span>
                          </div>
                          {e.description && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{e.description}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => setExpenseModal({ mode: 'add', year: selectedYear, month })}
                    className="mt-2 w-full px-2 py-1 text-[11px] font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M12 4v16m8-8H4" />
                    </svg>
                    Add R&D
                  </button>
                </div>
              );
            })}
          </div>

        </div>
      </main>

      {/* Modals */}
      {budgetModalOpen && (
        <RndBudgetModal
          year={selectedYear}
          currentAmount={annualBudget}
          currentNotes={yearBudget?.notes}
          onClose={() => setBudgetModalOpen(false)}
          onSaved={reload}
        />
      )}
      {expenseModal && (
        <RndExpenseModal
          editing={expenseModal.mode === 'edit' ? expenseModal.expense : null}
          defaultYear={expenseModal.mode === 'add' ? expenseModal.year : selectedYear}
          defaultMonth={expenseModal.mode === 'add' ? expenseModal.month : currentMonth}
          yearOptions={yearOptions}
          onClose={() => setExpenseModal(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
