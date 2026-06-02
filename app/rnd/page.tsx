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
import type { RndBudget, RndExpense, RndTeam, RndCategory } from '@/lib/data';
import { RND_CATEGORIES } from '@/lib/data';
import type { BudgetTeam } from '@/lib/data';
import { dbGetRndBudgets, dbGetRndExpenses, dbListBudgetTeams, dbCreateBudgetTeam, dbDeleteBudgetTeam } from '@/lib/db';
import TopBar from '@/app/components/TopBar';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import RndExpenseModal from '@/app/components/RndExpenseModal';
import RndBudgetModal from '@/app/components/RndBudgetModal';
import BudgetTeamsModal from '@/app/components/BudgetTeamsModal';

const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n || 0);
}

// Inline-style helper for the colored team pill — pulls fill from the
// per-team color (chosen by the user in BudgetTeamsModal) and chooses a
// matching text color via simple luminance check. Avoids dragging the
// dark-mode palette decisions in this file.
function teamBadgeStyle(color: string): React.CSSProperties {
  // Approximate luminance — values >0.6 get dark text, otherwise white.
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return {
    background: color + '33',   // 20% opacity tint as the fill
    color: lum > 0.6 ? '#1f2937' : color,
    border: `1px solid ${color}55`,
  };
}

export default function RndPage() {
  // No role gate: every authenticated user can view, add, edit, delete
  // any entry including the annual budgets. /rnd menu access alone gates
  // who reaches this page (see useMenuAccess ROLE_DEFAULTS).

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  // Top-of-page toggle: R&D (default) or Event. All budgets/expenses,
  // breakdown table, and the 12-month grid are scoped to this category.
  const [selectedCategory, setSelectedCategory] = useState<RndCategory>('rnd');
  // null = show all teams; otherwise scope the grid to that team only.
  const [selectedTeam, setSelectedTeam] = useState<RndTeam | null>(null);
  const [budgets, setBudgets] = useState<RndBudget[]>([]);
  const [expenses, setExpenses] = useState<RndExpense[]>([]);
  // Dynamic team list — sourced from the budget_teams table.
  const [teams, setTeams] = useState<BudgetTeam[]>([]);
  const [showManageTeams, setShowManageTeams] = useState(false);
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
      const [b, e, t] = await Promise.all([dbGetRndBudgets(), dbGetRndExpenses(), dbListBudgetTeams()]);
      setBudgets(b);
      setExpenses(e);
      setTeams(t);
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

  // Year + category scoped data. The same DB rows are reused for both
  // R&D and Event — distinguished by the `category` field — so this is
  // the single filter both layers below depend on.
  const yearBudgets = useMemo(
    () => budgets.filter((b) => b.year === selectedYear && b.category === selectedCategory),
    [budgets, selectedYear, selectedCategory],
  );
  const yearExpenses = useMemo(
    () => expenses.filter((e) => e.year === selectedYear && e.category === selectedCategory),
    [expenses, selectedYear, selectedCategory],
  );

  // Per-team aggregation: budget, spent, remaining
  interface TeamStat {
    team: RndTeam;
    label: string;
    color: string;
    budget: number;
    spent: number;
    remaining: number;
    usedPct: number;
    budgetRow?: RndBudget;
  }
  const teamStats: TeamStat[] = useMemo(() => {
    return teams.map((t) => {
      const budgetRow = yearBudgets.find((b) => b.team === t.id);
      const budget = budgetRow?.annualAmount ?? 0;
      const spent = yearExpenses.filter((e) => e.team === t.id).reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const remaining = budget - spent;
      const usedPct = budget > 0 ? (spent / budget) * 100 : 0;
      return { team: t.id, label: t.label, color: t.color, budget, spent, remaining, usedPct, budgetRow };
    });
  }, [teams, yearBudgets, yearExpenses]);

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

  // Inline "Add team" form state on the breakdown table.
  const [inlineLabel, setInlineLabel] = useState('');
  const [inlineColor, setInlineColor] = useState('#3B82F6');
  const [inlineBusy, setInlineBusy] = useState(false);

  function describeErr(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      const msg = [
        e.message ? String(e.message) : '',
        e.details ? ` — ${e.details}` : '',
        e.hint    ? ` (hint: ${e.hint})` : '',
        e.code    ? ` [${e.code}]` : '',
      ].join('').trim();
      if (msg) return msg;
    }
    return String(err);
  }

  function slugifyTeam(label: string): string {
    return label.trim().toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'team';
  }

  async function inlineAddTeam(ev: React.FormEvent) {
    ev.preventDefault();
    if (!inlineLabel.trim() || inlineBusy) return;
    setInlineBusy(true);
    setError(null);
    try {
      const base = slugifyTeam(inlineLabel);
      let id = base; let i = 2;
      while (teams.some((t) => t.id === id)) { id = `${base}-${i}`; i++; }
      const nextSort = Math.max(0, ...teams.filter((t) => !t.isSystem).map((t) => t.sortOrder ?? 0)) + 10;
      await dbCreateBudgetTeam({ id, label: inlineLabel.trim(), color: inlineColor, sortOrder: nextSort, isSystem: false });
      setInlineLabel(''); setInlineColor('#3B82F6');
      await reload();
    } catch (err) {
      setError(describeErr(err));
    } finally {
      setInlineBusy(false);
    }
  }

  async function inlineDeleteTeam(t: TeamStat) {
    const tm = teams.find((x) => x.id === t.team);
    if (!tm || tm.isSystem) return;
    const ok = confirm(
      `Delete team "${t.label}"?\n\n` +
      `• Budgets set for this team will be removed.\n` +
      `• Expenses logged under this team will be moved to "Other" so the spend isn't lost.\n\n` +
      `This cannot be undone.`,
    );
    if (!ok) return;
    setError(null);
    try {
      await dbDeleteBudgetTeam(t.team, 'other');
      // If this team was the active filter, drop back to "All teams".
      if (selectedTeam === t.team) setSelectedTeam(null);
      await reload();
    } catch (err) {
      setError(describeErr(err));
    }
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar placeholder="Search R&D..." />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">

          {/* Title bar */}
          <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${
                selectedCategory === 'rnd'
                  ? 'bg-blue-50 dark:bg-blue-950/40'
                  : 'bg-purple-50 dark:bg-purple-950/40'
              }`}>
                {selectedCategory === 'rnd' ? (
                  /* Flask — R&D */
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 3h6m-5 0v6.5L4 19a2 2 0 001.7 3h12.6a2 2 0 001.7-3L14 9.5V3" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 15h10" />
                  </svg>
                ) : (
                  /* Calendar/ticket — Event */
                  <svg className="w-5 h-5 text-purple-600 dark:text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
              </span>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {selectedCategory === 'rnd' ? 'R&D' : 'Event'}
                </h1>
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

          {/* R&D / Event toggle.
              Pill-style segmented control. Switching here re-filters
              every layer below — budgets, breakdown table, grid — by
              the matching `category` field on each row. */}
          <div className="mb-5 inline-flex p-0.5 rounded-lg bg-gray-100 dark:bg-slate-800">
            {RND_CATEGORIES.map((c) => {
              const isActive = c.id === selectedCategory;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedCategory(c.id);
                    // Reset team filter when switching category so the
                    // user always lands on the "All teams" view of the
                    // new section.
                    setSelectedTeam(null);
                  }}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
                  }`}
                  aria-pressed={isActive}
                >
                  {c.label}
                </button>
              );
            })}
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
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium" style={teamBadgeStyle(t.color)}>{t.label}</span>
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
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => setBudgetModal({ team: t.team })}
                          className="text-xs px-2 py-0.5 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-slate-800"
                        >
                          {t.budget > 0 ? 'Edit' : 'Set'}
                        </button>
                        {(() => {
                          const tm = teams.find((x) => x.id === t.team);
                          if (!tm || tm.isSystem) return null;
                          return (
                            <button
                              onClick={() => inlineDeleteTeam(t)}
                              className="ml-1 text-xs p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/30"
                              title={`Delete team "${t.label}"`}
                              aria-label={`Delete team ${t.label}`}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50/60 dark:bg-slate-800/30">
                    <td className="px-4 py-2" colSpan={6}>
                      <form onSubmit={inlineAddTeam} className="flex items-center gap-2">
                        <input
                          type="color"
                          value={inlineColor}
                          onChange={(e) => setInlineColor(e.target.value)}
                          className="w-7 h-7 rounded border border-gray-300 dark:border-slate-600 bg-transparent cursor-pointer flex-shrink-0"
                          title="Pick a color"
                        />
                        <input
                          type="text"
                          value={inlineLabel}
                          onChange={(e) => setInlineLabel(e.target.value)}
                          placeholder="Add a new team (e.g. Aquaculture)"
                          className="flex-1 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                        <button
                          type="submit"
                          disabled={!inlineLabel.trim() || inlineBusy}
                          className="text-xs px-3 py-1 bg-green-700 hover:bg-green-800 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {inlineBusy ? 'Adding…' : '+ Add team'}
                        </button>
                      </form>
                    </td>
                  </tr>
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
            {teams.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTeam(t.id)}
                className="px-2.5 py-1 rounded text-xs font-medium border transition-colors"
                style={
                  selectedTeam === t.id
                    ? teamBadgeStyle(t.color)
                    : undefined
                }
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={() => setShowManageTeams(true)}
              className="ml-2 px-2.5 py-1 rounded text-xs font-medium border border-dashed border-gray-300 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
              title="Add, rename, recolor, or remove teams"
            >
              + Manage teams
            </button>
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
                            {selectedTeam === null && (() => {
                              const tm = teams.find((tt) => tt.id === e.team);
                              return (
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                  style={teamBadgeStyle(tm?.color ?? '#6B7280')}
                                >
                                  {tm?.label ?? e.team}
                                </span>
                              );
                            })()}
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
            teamLabel={teams.find((tm) => tm.id === budgetModal.team)?.label ?? budgetModal.team}
            category={selectedCategory}
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
          category={selectedCategory}
          yearOptions={yearOptions}
          teams={teams}
          onClose={() => setExpenseModal(null)}
          onChanged={reload}
        />
      )}
      {showManageTeams && (
        <BudgetTeamsModal
          onClose={() => setShowManageTeams(false)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
