'use client';

/**
 * AI Marketing Report — Week-ending picker + Activities inputs.
 *
 * Generates the "R&D Weekly Report" Word document that mirrors the legacy
 * template used by the Marketing team for their Friday sync.
 *
 * What this modal asks the user for:
 *   - Week-ending date  → defaults to upcoming Friday
 *   - Activities table  → 6 fixed rows × 3 columns
 *                         (auto-prefilled from the previous report stored
 *                          in localStorage so the user mostly edits)
 *
 * What's automatic (no user input):
 *   - Spending table   → server fetches rnd_budgets/rnd_expenses
 *   - Author name      → from next-auth session
 *   - This-Month-Focus → left blank in the Word doc (user fills by hand)
 */

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import SubmitButton from './SubmitButton';

interface Props {
  onClose: () => void;
}

// Section labels are fixed to match the source template.
const ACTIVITY_TEAMS = ['Poultry', 'Ruminant', 'LATAM', 'R&D', 'Others', 'Travel'];

type ActivitiesMap = Record<string, { completed: string; ongoing: string; plan: string }>;

const STORAGE_KEY = 'marketing-weekly-activities-v1';

function emptyActivities(): ActivitiesMap {
  const o: ActivitiesMap = {};
  for (const t of ACTIVITY_TEAMS) o[t] = { completed: '', ongoing: '', plan: '' };
  return o;
}

function loadSavedActivities(): ActivitiesMap {
  if (typeof window === 'undefined') return emptyActivities();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyActivities();
    const parsed = JSON.parse(raw) as ActivitiesMap;
    // Merge so newly-added teams (or schema bumps) don't crash.
    const merged = emptyActivities();
    for (const t of ACTIVITY_TEAMS) {
      if (parsed[t]) merged[t] = { ...merged[t], ...parsed[t] };
    }
    return merged;
  } catch {
    return emptyActivities();
  }
}

function nextFriday(today = new Date()): string {
  const d = new Date(today);
  const day = d.getDay();
  const delta = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

export default function MarketingWeeklyModal({ onClose }: Props) {
  const { data: session } = useSession();
  const authorName = session?.user?.name ?? '';

  const [weekEnding, setWeekEnding] = useState<string>(nextFriday());
  // Lazy init pulls the previous activity content from localStorage so
  // the user opens the modal already prefilled with last week's text.
  const [activitiesByTeam, setActivitiesByTeam] = useState<ActivitiesMap>(() => loadSavedActivities());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect whether we actually prefilled anything so we can show a small
  // banner — "Pulled in from your previous report" — and a Reset button.
  const hasPrefill = useMemo(() => {
    return Object.values(activitiesByTeam).some((row) =>
      (row.completed || row.ongoing || row.plan || '').trim().length > 0,
    );
  }, [activitiesByTeam]);

  function setActivity(team: string, col: 'completed' | 'ongoing' | 'plan', text: string) {
    setActivitiesByTeam((prev) => ({
      ...prev,
      [team]: { ...(prev[team] || { completed: '', ongoing: '', plan: '' }), [col]: text },
    }));
  }

  function resetActivities() {
    if (!confirm('Clear all activity fields? You will lose the prefilled content.')) return;
    setActivitiesByTeam(emptyActivities());
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
        body: JSON.stringify({
          weekEndingDate: weekEnding,
          authorName,
          // Focus section is intentionally NOT sent — the server leaves
          // that table's content cell blank for the user to fill in.
          activitiesByTeam,
        }),
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
      // Save the just-submitted activities as the new "previous report"
      // — the next time the modal opens it will prefill from here.
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(activitiesByTeam)); }
      catch { /* private mode etc. — fine */ }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // Save on every keystroke too (debounced via React's batching) so the
  // user doesn't lose work if they close the modal without generating.
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(activitiesByTeam)); }
    catch { /* */ }
  }, [activitiesByTeam]);

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
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              Defaults to upcoming Friday. The Spending table pulls the year/quarter from this date.
              {authorName && <span className="ml-1">Author header will read: <strong>{authorName}</strong>.</span>}
            </p>
          </div>

          {/* Activities grid */}
          <section>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Activities</h3>
              {hasPrefill && (
                <button
                  type="button"
                  onClick={resetActivities}
                  className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 underline"
                >
                  Reset all
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
              One bullet per line in each cell. Empty cells stay empty in the Word doc.
              {hasPrefill && <span className="ml-1 text-green-700 dark:text-green-400">Prefilled from your previous report — edit in place.</span>}
            </p>
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
                              rows={4}
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
