'use client';

/**
 * Modal that lets a user pick (year, month) for the AI Monthly
 * Presentation PPT, then POSTs to /api/reports/monthly-presentation and
 * triggers the .pptx download.
 *
 * Defaults to the most recently completed month for the current year —
 * that's what users almost always want ("give me last month's report").
 *
 * Mirrors the spinner / disabled pattern from SubmitButton and the
 * Resend / Weekly Report modals.
 */

import { useEffect, useMemo, useState } from 'react';

interface Props {
  /** Team report type, passed straight through to the API. */
  reportType: 'monogastrics' | 'ruminants' | 'latam' | 'familyb2b' | 'all';
  /** Display label for the modal header, e.g. "Monogastric Report". */
  reportLabel: string;
  onClose: () => void;
}

const MONTH_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function MonthlyPresentationModal({ reportType, reportLabel, onClose }: Props) {
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Default: last completed month. If we're in January, default to
  // last December of the previous year.
  const [year, setYear] = useState<number>(currentMonth === 1 ? currentYear - 1 : currentYear);
  const [month, setMonth] = useState<number>(currentMonth === 1 ? 12 : currentMonth - 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yearOptions = useMemo(() => {
    // Current year + 2 prior. Users rarely want anything older.
    return [currentYear, currentYear - 1, currentYear - 2];
  }, [currentYear]);

  // Months available for the selected year: if it's the current year,
  // cap at the current month (you can't "report" June from May). For
  // past years, all 12 are valid.
  const maxMonth = year === currentYear ? currentMonth : 12;
  // Keep month within range when the user flips years.
  useEffect(() => {
    if (month > maxMonth) setMonth(maxMonth);
  }, [year, maxMonth, month]);

  // ESC to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !submitting) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  async function handleGenerate() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/reports/monthly-presentation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportType, year, month }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* */ }
        throw new Error(msg);
      }
      // Download the .pptx
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Filename comes from server header, but browsers still need the
      // anchor `download` attr to suppress in-tab navigation.
      a.download = `${reportLabel.replace(/\s+/g, '_')}_${MONTH_LONG[month - 1]}_${year}.pptx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Monthly presentation generation failed:', msg);
      setError(`Generation failed: ${msg}`);
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
     
      tabIndex={-1}
    >
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              AI Monthly Presentation
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{reportLabel}</p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Pick the month to report on. The PPT will include the annual budget,
          year-to-date achievement, the selected month&apos;s budget vs. actual,
          and a cumulative line chart through {MONTH_LONG[month - 1]}.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Year</label>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              disabled={submitting}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            >
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
              disabled={submitting}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            >
              {MONTH_LONG.slice(0, maxMonth).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
        </div>

        {error && (
          <div role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2 mb-3">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white shadow-sm"
          >
            {submitting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Generating PPT…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
                Generate &amp; Download
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
