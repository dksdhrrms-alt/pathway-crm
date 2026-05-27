'use client';

/**
 * R&D expense add/edit modal.
 *
 * Add mode: month/year pre-filled from the card the user clicked.
 * Edit mode: pre-fills name/description/amount and offers Save/Delete.
 *
 * Validation:
 *   - name required (non-blank)
 *   - amount required, must parse to a positive number
 *   - month/year selectable (in case the user wants to move the entry)
 *
 * Delete is a soft-delete via lib/db.dbDeleteRndExpense which sets
 * archived_at — same pattern as activities/contacts so we keep history.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { RndExpense, RndTeam, RndCategory } from '@/lib/data';
import { generateId, RND_TEAMS } from '@/lib/data';
import { dbCreateRndExpense, dbUpdateRndExpense, dbDeleteRndExpense } from '@/lib/db';
import SubmitButton from './SubmitButton';

const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

interface Props {
  /** When set, edit that expense. When null/undefined and `defaultYear`/`defaultMonth` are set, create new. */
  editing?: RndExpense | null;
  defaultYear: number;
  defaultMonth: number;
  /** Pre-select this team when adding a new entry. Useful when the user
   *  clicked + Add from inside a team-filtered view. */
  defaultTeam?: RndTeam;
  /** Category bucket: 'rnd' or 'event'. Pinned to whatever the page is
   *  currently showing — users don't change it inside the modal. */
  category: RndCategory;
  /** Years that should appear in the year dropdown — current year + a few around it. */
  yearOptions: number[];
  onClose: () => void;
  /** Called after a successful save/delete so the parent can refresh. */
  onChanged: () => void;
}

export default function RndExpenseModal({ editing, defaultYear, defaultMonth, defaultTeam, category, yearOptions, onClose, onChanged }: Props) {
  const { data: session } = useSession();
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [amount, setAmount] = useState<string>(editing ? String(editing.amount) : '');
  const [year, setYear] = useState<number>(editing?.year ?? defaultYear);
  const [month, setMonth] = useState<number>(editing?.month ?? defaultMonth);
  const [team, setTeam] = useState<RndTeam>(editing?.team ?? defaultTeam ?? 'other');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !submitting) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) { setError('Name is required.'); return; }
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) { setError('Amount must be a positive number.'); return; }

    setSubmitting(true);
    try {
      if (editing) {
        await dbUpdateRndExpense(editing.id, {
          name: trimmedName,
          description: description.trim() || undefined,
          amount: parsedAmount,
          year,
          month,
          team,
          // category stays the same on edit — the page-level toggle owns it.
        });
      } else {
        await dbCreateRndExpense({
          id: generateId(),
          year,
          month,
          team,
          category,
          name: trimmedName,
          description: description.trim() || undefined,
          amount: parsedAmount,
          ownerId: session?.user?.id ?? '',
        });
      }
      onChanged();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('RndExpenseModal save failed:', msg);
      setError(`Save failed: ${msg}`);
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm(`Delete "${editing.name}"?\nThis archives the entry. It can be restored from the database if needed.`)) return;
    setSubmitting(true);
    try {
      await dbDeleteRndExpense(editing.id);
      onChanged();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Delete failed: ${msg}`);
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
            {editing ? 'Edit R&D entry' : 'Add R&D entry'}
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
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. LIPIDOL Trial Q2"
              autoFocus
              required
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Description <span className="text-gray-400 dark:text-gray-500 text-xs">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief context — e.g. Iowa State broiler study, Phase 2"
              rows={2}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Team <span className="text-red-500">*</span>
            </label>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value as RndTeam)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {RND_TEAMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">This expense counts against the selected team&apos;s annual budget.</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Year</label>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Month</label>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value))}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {MONTH_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Amount ($) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {error && (
            <div role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            {editing ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50"
              >
                Delete
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <SubmitButton type="submit" pending={submitting}>
                {editing ? 'Save' : 'Add'}
              </SubmitButton>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
