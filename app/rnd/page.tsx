'use client';

/**
 * /rnd — R&D yearly budget tracker (per team).
 *
 * Budgets and expenses are split across 5 teams:
 *   Ruminant · Poultry · Swine · LATAM · Other
 *
 * Layout:
 *   - Title bar with year selector + team filter chips.
 *   - Aggregate summary band (sum across all teams).
 *   - Per-team breakdown table — one row per team with its own budget
 *     vs spent vs remaining, plus an "Edit" pencil to update that
 *     team's annual amount independently.
 *   - 12-card month grid — when "All teams" is selected each entry
 *     shows a team-colored badge; when one team is filtered the grid
 *     shows only that team's entries.
 *
 * Why two layers (aggregate + per-team):
 *   - Aggregate gives a fast "are we on track overall?" answer.
 *   - Per-team is where day-to-day decisions are made — adjusting a
 *     team's budget mid-year, seeing who's burning hot/cold.
 *
 * Permissions: every authenticated user (gated by /rnd menu access in
 * useMenuAccess) can read and write everything — budgets and expenses.
 */

import { useEffect, useMemo, useState } from 'react';
import type { RndBudget, RndExpense, RndTeam } from '@/lib/data';
import { RND_TEAMS } from '@/lib/data';
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

// Tailwind class snippets per team — small pill / badge style.
const TEAM_BADGE: Record<RndTeam, string> = {
  ruminant: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  poultry:  'bg-blue-100  text-blue-800  dark:bg-blue-950/40  dark:text-blue-300',
  swine:    'bg-pink-100  text-pink-800  dark:bg-pink-950/40  dark:text-pink-300',
  latam:    'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  other:    'bg-gray-100  text-gray-700  dark:bg-slate-800    dark:text-gray-300',
};

export default function RndPage() {
  // No role gate: every authenticated user can view, add, edit, delete
  // any entry including the annual budgets. /rnd menu access alone gates
  // who reaches this page (see useMenuAccess ROLE_DEFAULTS).

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  // null = show all teams; otherwise scope the grid to that team only.
  const [selectedTeam, setSelectedTeam] = useState<RndTeam | null>(null);
  const [budgets, setBudgets] = useState<RndBudget[]>([]);
  const [expenses, setExpenses] = useState<RndExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [budgetModal, setBudgetModal] = useState<{ team: RndTeam } | null>(null);
  const [expenseModal, setExpenseModal] = useState<
    | { mode: 'add'; year: number; month: number; team: RndTeam }
    | { mode: 'edit'; expense: RndExpense }
    | null
  >(null);

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

  const yearOptions = useMemo(() => {
    const set = new Set<number>([currentYear, currentYear - 1, currentYear + 1]);
    for (const b of budgets) set.add(b.year);
    for (const e of expenses) set.add(e.year);
    return [...set].sort((a, b) => b - a);
  }, [budgets, expenses, currentYear]);

  // Year-scoped data
  const yearBudgets = useMemo(
    () => budgets.filter((b) => b.year === selectedYear),
    [budgets, selectedYear],
  );
  const yearExpenses = useMemo(
    () => expenses.filter((e) => e.year === selectedYear),
    [expenses, selectedYear],
  );

  // Per-team aggregation: budget, spent, remaining
  interface TeamStat {
    team: RndTeam;
    label: string;
    budget: number;
    spent: number;
    remaining: number;
    usedPct: number;
    budgetRow?: RndBudget;
  }
  const teamStats: TeamStat[] = useMemo(() => {
    return RND_TEAMS.map(({ id, label }) => {
      const budgetRow = yearBudgets.find((b) => b.team === id);
      const budget = budgetRow?.annualAmount ?? 0;
      const spent = yearExpenses.filter((e) => e.team === id).reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const remaining = budget - spent;
      const usedPct = budget > 0 ? (spent / budget) * 100 : 0;
      return { team: id, label, budget, spent, remaining, usedPct, budgetRow };
    });
  }, [yearBudgets, yearExpenses]);

  // Aggregate (sum of all teams)
  const totals = useMemo(() => {
    const budget = teamStats.reduce((s, t) => s + t.budget, 0);
    const spent  = teamStats.reduce((s, t) => s + t.spent, 0);
    return { budget, spent, remaining: budget - spent, usedPct: budget > 0 ? (spent / budget) * 100 : 0 };
  }, [teamStats]);

  // Expenses scoped to the team-filter (used by the 12-month grid)
  const filteredExpenses = useMemo(
    () => selectedTeam ? yearExpenses.filter((e) => e.team === selectedTeam) : yearExpenses,
    [yearExpenses, selectedTeam],
  );

  const byMonth = useMemo(() => {
    const m: Record<number, RndExpense[]> = {};
    for (let i = 1; i <= 12; i++) m[i] = [];
    for (const e of filteredExpenses) m[e.month]?.push(e);
    for (const k of Object.keys(m)) {
      m[Number(k)].sort((a, b) => (b.amount || 0) - (a.amount || 0));
    }
    return m;
  }, [filteredExpenses]);

  // When the user clicks + Add inside the grid we default the new
  // entry's team to the current filter (or 'other' when no filter).
  function openAdd(month: number) {
    setExpenseModal({
      mode: 'add',
      year: selectedYear,
      month,
      team: selectedTeam ?? 'other',
    });
  }

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
                <p className="text-sm text-gray-500 dark:text-gray-400">Annual budget tracker — per team</p>
              </div>
            </div>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {/* Aggregate summary band */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm p-4 mb-4">
            <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">All teams — {selectedYear}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Total budget</p>
                <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">{fmtUSD(totals.budget)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Spent</p>
                <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">{fmtUSD(totals.spent)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Remaining</p>
                <p className={`mt-1 text-xl font-semibold ${totals.remaining >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                  {fmtUSD(totals.remaining)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Used</p>
                <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">{totals.usedPct.toFixed(0)}%</p>
                <div className="mt-2 h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${totals.usedPct > 100 ? 'bg-red-500' : totals.usedPct > 80 ? 'bg-amber-500' : 'bg-green-600'}`}
                    style={{ width: `${Math.min(totals.usedPct, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Per-team breakdown table */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden mb-5">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800/50 text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Team</th>
                    <th className="text-right px-4 py-2 font-semibold">Budget</th>
                    <th className="text-right px-4 py-2 font-semibold">Spent</th>
                    <th className="text-right px-4 py-2 font-semibold">Remaining</th>
                    <th className="text-left px-4 py-2 font-semibold w-40">Used</th>
                    <th className="text-right px-4 py-2 font-semibold w-24"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {teamStats.map((t) => (
                    <tr key={t.team} className="hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TEAM_BADGE[t.team]}`}>{t.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-gray-100">{fmtUSD(t.budget)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtUSD(t.spent)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${t.remaining >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                        {fmtUSD(t.remaining)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${t.usedPct > 100 ? 'bg-red-500' : t.usedPct > 80 ? 'bg-amber-500' : 'bg-green-600'}`}
                              style={{ width: `${Math.min(t.usedPct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300 w-10 text-right">{t.budget > 0 ? `${t.usedPct.toFixed(0)}%` : '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setBudgetModal({ team: t.team })}
                          className="text-xs px-2 py-0.5 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-slate-800"
                        >
                          {t.budget > 0 ? 'Edit' : 'Set'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Team filter chips */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Show entries for:</span>
            <button
              onClick={() => setSelectedTeam(null)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                selectedTeam === null
                  ? 'bg-gray-800 dark:bg-slate-100 text-white dark:text-slate-900 border-gray-800 dark:border-slate-100'
                  : 'border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800'
              }`}
            >
              All teams
            </button>
            {RND_TEAMS.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTeam(t.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  selectedTeam === t.id
                    ? `${TEAM_BADGE[t.id]} border-transparent`
                    : 'border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
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
                          <div className="flex justify-between gap-2 items-baseline">
                            <span className="font-medium text-gray-900 dark:text-gray-100 truncate flex-1">{e.name}</span>
                            <span className="tabular-nums text-gray-600 dark:text-gray-300 flex-shrink-0">{fmtUSD(e.amount)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            {selectedTeam === null && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TEAM_BADGE[e.team]}`}>
                                {RND_TEAMS.find((t) => t.id === e.team)?.label ?? e.team}
                              </span>
                            )}
                            {e.description && (
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate flex-1">{e.description}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => openAdd(month)}
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
      {budgetModal && (() => {
        const t = teamStats.find((s) => s.team === budgetModal.team);
        return (
          <RndBudgetModal
            year={selectedYear}
            team={budgetModal.team}
            currentAmount={t?.budget ?? 0}
            currentNotes={t?.budgetRow?.notes}
            onClose={() => setBudgetModal(null)}
            onSaved={reload}
          />
        );
      })()}
      {expenseModal && (
        <RndExpenseModal
          editing={expenseModal.mode === 'edit' ? expenseModal.expense : null}
          defaultYear={expenseModal.mode === 'add' ? expenseModal.year : selectedYear}
          defaultMonth={expenseModal.mode === 'add' ? expenseModal.month : currentMonth}
          defaultTeam={expenseModal.mode === 'add' ? expenseModal.team : undefined}
          yearOptions={yearOptions}
          onClose={() => setExpenseModal(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
