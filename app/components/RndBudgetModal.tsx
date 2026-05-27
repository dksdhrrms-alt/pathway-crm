'use client';

/**
 * R&D annual budget edit modal.
 *
 * One row per year in rnd_budgets — id = `rnd-budget-<year>`. Upsert
 * means first save creates the row, subsequent saves overwrite the
 * annual_amount in place. Notes are optional free-text (e.g. "+$50K
 * approved by board Mar 2026").
 *
 * No delete — instead set amount to 0 if you want to "remove" a year's
 * budget. Year is locked once the row exists (a different year = a
 * different row).
 */

import { useEffect, useState } from 'react';
import { dbUpsertRndBudget } from '@/lib/db';
import type { RndTeam } from '@/lib/data';
import { RND_TEAMS } from '@/lib/data';
import SubmitButton from './SubmitButton';

interface Props {
  year: number;
  team: RndTeam;
  currentAmount: number;
  currentNotes?: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function RndBudgetModal({ year, team, currentAmount, currentNotes, onClose, onSaved }: Props) {
  const teamLabel = RND_TEAMS.find((t) => t.id === team)?.label ?? team;
  const [amount, setAmount] = useState<string>(currentAmount > 0 ? String(currentAmount) : '');
  const [notes, setNotes] = useState<string>(currentNotes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !submitting) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed < 0) { setError('Amount must be a positive number.'); return; }
    setSubmitting(true);
    try {
      await dbUpsertRndBudget(year, team, parsed, notes.trim() || undefined);
      onSaved();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('RndBudgetModal save failed:', msg);
      setError(`Save failed: ${msg}`);
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
      tabIndex={-1}
    >
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            R&D budget — {teamLabel} {year}
          </h2>
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

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Annual amount ($) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="1"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500000"
              required
              autoFocus
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{teamLabel} team&apos;s annual budget for {year}. Spending tagged to {teamLabel} is tracked against this number.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Notes <span className="text-gray-400 dark:text-gray-500 text-xs">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. +$50K approved by board in March"
              rows={2}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>

          {error && (
            <div role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <SubmitButton pending={submitting}>Save</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
