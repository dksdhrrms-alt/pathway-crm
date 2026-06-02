'use client';

/**
 * Manage the master list of Budget-Tracker team labels.
 *
 * Lives behind the "Manage teams" button on /rnd. Every authenticated
 * user can add, rename, recolor, or delete teams. The system-protected
 * 'other' row cannot be deleted — it's the fallback bucket that
 * absorbs orphaned expenses when another team is removed.
 *
 * Deletion flow: rnd_budgets rows tied to the team are dropped; rnd_expenses
 * rows are reassigned to 'other' so historical spend is preserved. The
 * confirmation prompt spells this out before committing.
 */

import { useEffect, useState } from 'react';
import type { BudgetTeam } from '@/lib/data';
import { dbListBudgetTeams, dbCreateBudgetTeam, dbUpdateBudgetTeam, dbDeleteBudgetTeam } from '@/lib/db';
import SubmitButton from './SubmitButton';

interface Props {
  onClose: () => void;
  onChanged: () => void;  // parent refetches its team list + budgets/expenses
}

function slugify(label: string): string {
  // Lower-case, ascii-fold what we can, hyphen-collapse the rest.
  return label.trim().toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'team';
}

export default function BudgetTeamsModal({ onClose, onChanged }: Props) {
  const [teams, setTeams] = useState<BudgetTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-team form state.
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#3B82F6');
  const [submitting, setSubmitting] = useState(false);

  // Inline edit state — keyed by team id while a row is being renamed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('#000000');

  async function load() {
    setLoading(true);
    try {
      const list = await dbListBudgetTeams();
      setTeams(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Build a slug; ensure uniqueness by appending a counter if needed.
      const base = slugify(newLabel);
      let id = base;
      let i = 2;
      while (teams.some((t) => t.id === id)) { id = `${base}-${i}`; i++; }
      const nextSortOrder = Math.max(0, ...teams.filter((t) => !t.isSystem).map((t) => t.sortOrder ?? 0)) + 10;
      await dbCreateBudgetTeam({
        id,
        label: newLabel.trim(),
        color: newColor,
        sortOrder: nextSortOrder,
        isSystem: false,
      });
      setNewLabel('');
      setNewColor('#3B82F6');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(t: BudgetTeam) {
    setEditingId(t.id);
    setEditLabel(t.label);
    setEditColor(t.color);
  }

  async function saveEdit() {
    if (!editingId) return;
    setSubmitting(true);
    setError(null);
    try {
      await dbUpdateBudgetTeam(editingId, { label: editLabel.trim() || 'Untitled', color: editColor });
      setEditingId(null);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(t: BudgetTeam) {
    if (t.isSystem) return;
    const ok = confirm(
      `Delete team "${t.label}"?\n\n` +
      `• Any budgets set for this team will be removed.\n` +
      `• Any expenses logged under this team will be moved to "Other" so the spend isn't lost.\n\n` +
      `This cannot be undone.`,
    );
    if (!ok) return;
    setSubmitting(true);
    setError(null);
    try {
      await dbDeleteBudgetTeam(t.id, 'other');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Manage Budget Teams</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Labels here apply only to the Budget Tracker (R&amp;D + Event). Other CRM areas use their own team lists.
            </p>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* List */}
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-100 dark:divide-slate-800 mb-4">
          {loading && <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-3">Loading…</p>}
          {!loading && teams.map((t) => {
            const isEditing = editingId === t.id;
            return (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2">
                {isEditing ? (
                  <>
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="w-7 h-7 rounded border border-gray-300 dark:border-slate-600 bg-transparent cursor-pointer"
                      title="Pick a color"
                    />
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="flex-1 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                      autoFocus
                    />
                    <button onClick={saveEdit} disabled={submitting} className="text-xs px-2 py-1 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50">Save</button>
                    <button onClick={() => setEditingId(null)} disabled={submitting} className="text-xs px-2 py-1 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50">Cancel</button>
                  </>
                ) : (
                  <>
                    <span
                      className="inline-block w-4 h-4 rounded-full flex-shrink-0"
                      style={{ background: t.color }}
                      title={t.color}
                    />
                    <span className="flex-1 text-sm text-gray-800 dark:text-gray-100">{t.label}</span>
                    {t.isSystem ? (
                      <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500" title="System label — cannot be deleted">System</span>
                    ) : (
                      <>
                        <button onClick={() => startEdit(t)} className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-0.5 border border-gray-300 dark:border-slate-600 rounded hover:bg-gray-50 dark:hover:bg-slate-800">Edit</button>
                        <button onClick={() => handleDelete(t)} disabled={submitting} className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 px-2 py-0.5 border border-red-200 dark:border-red-900 rounded hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50">Delete</button>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* New-team form */}
        <form onSubmit={handleAdd} className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Add a new team</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-9 h-9 rounded border border-gray-300 dark:border-slate-600 bg-transparent cursor-pointer"
              title="Pick a color"
            />
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Team name (e.g. Aquaculture)"
              className="flex-1 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <SubmitButton type="submit" pending={submitting} pendingText="Adding…">Add</SubmitButton>
          </div>
        </form>

        {error && (
          <div role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
