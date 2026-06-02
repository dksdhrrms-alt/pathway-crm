'use client';

/**
 * AI Marketing Report — Week-ending picker + Focus/Activities inputs.
 *
 * Generates the "R&D Weekly Report" Word document that mirrors the legacy
 * template (R&D Weekly Report_<date>.docx) used by the Marketing team
 * for their Friday sync. The Spending table inside the report is auto-
 * populated by the server from rnd_budgets/rnd_expenses — the user only
 * fills in Focus + Activities here.
 *
 * Posts to /api/reports/marketing-weekly which streams back a docx blob.
 */

import { useMemo, useState } from 'react';
import SubmitButton from './SubmitButton';

interface Props {
  onClose: () => void;
}

// Section labels are fixed to match the source template — the dynamic
// budget_teams list only drives the Spending table.
const FOCUS_TEAMS = ['Poultry', 'Ruminant', 'LATAM', 'R&D (New Product Development)'];
const ACTIVITY_TEAMS = ['Poultry', 'Ruminant', 'LATAM', 'R&D', 'Others', 'Travel'];

function nextFriday(today = new Date()): string {
  // Default to upcoming Friday so the modal opens with a sensible date.
  const d = new Date(today);
  const day = d.getDay();                       // 0=Sun..6=Sat
  const delta = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

export default function MarketingWeeklyModal({ onClose }: Props) {
  const [weekEnding, setWeekEnding] = useState<string>(nextFriday());
  const [focusByTeam, setFocusByTeam] = useState<Record<string, string>>({});
  const [activitiesByTeam, setActivitiesByTeam] = useState<Record<string, { completed: string; ongoing: string; plan: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setFocus(team: string, text: string) {
    setFocusByTeam((prev) => ({ ...prev, [team]: text }));
  }
  function setActivity(team: string, col: 'completed' | 'ongoing' | 'plan', text: string) {
    setActivitiesByTeam((prev) => ({
      ...prev,
      [team]: { ...(prev[team] || { completed: '', ongoing: '', plan: '' }), [col]: text },
    }));
  }

  const filename = useMemo(
    () => `R&D Weekly Report_${weekEnding.replace(/-/g, '.')}.docx`,
    [weekEnding],
  );

  async function handleGenerate() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/reports/marketing-weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekEndingDate: weekEnding, focusByTeam, activitiesByTeam }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text || `Server returned ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 px-6 py-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">AI Marketing Report</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Generates an R&amp;D Weekly Report (.docx) matching the template. Spending table auto-fills from Budget Tracker.
            </p>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Week ending date */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Week ending</label>
            <input
              type="date"
              value={weekEnding}
              onChange={(e) => setWeekEnding(e.target.value)}
              className="border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Defaults to upcoming Friday. The Spending table pulls the year from this date.</p>
          </div>

          {/* This Month's Focus */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">This Month&apos;s Focus Activities, Goals and Progress</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">One bullet per line. Each team becomes a top-level bullet in the report.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {FOCUS_TEAMS.map((team) => (
                <div key={team}>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{team}</label>
                  <textarea
                    value={focusByTeam[team] || ''}
                    onChange={(e) => setFocus(team, e.target.value)}
                    rows={4}
                    placeholder={`e.g. ISU layer trial (Lipidol Prime, Endo-Power, NuFex)\nUGA broiler trial (Lipidol Prime)`}
                    className="w-full text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Activities grid */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">Activities</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">One bullet per line in each cell. Empty cells stay empty in the Word doc.</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-gray-50 dark:bg-slate-800/50">
                  <tr>
                    <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-300 w-24">Team</th>
                    <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-300">Completed</th>
                    <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-300">On-going (this week)</th>
                    <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-300">Plan (next week)</th>
                  </tr>
                </thead>
                <tbody>
                  {ACTIVITY_TEAMS.map((team) => {
                    const row = activitiesByTeam[team] || { completed: '', ongoing: '', plan: '' };
                    return (
                      <tr key={team} className="border-t border-gray-100 dark:border-slate-800">
                        <td className="px-2 py-2 align-top font-medium text-gray-800 dark:text-gray-100 whitespace-nowrap">{team}</td>
                        {(['completed', 'ongoing', 'plan'] as const).map((col) => (
                          <td key={col} className="px-1 py-1 align-top">
                            <textarea
                              value={row[col]}
                              onChange={(e) => setActivity(team, col, e.target.value)}
                              rows={3}
                              className="w-full text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-green-500 resize-y"
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {error && (
            <div role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 px-6 py-3 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50">Cancel</button>
          <SubmitButton type="button" onClick={handleGenerate} pending={submitting} pendingText="Generating…">
            Generate Word
          </SubmitButton>
        </div>
      </div>
    </div>
  );
}
