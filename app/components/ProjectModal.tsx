'use client';

/**
 * Marketing project add/edit modal.
 *
 * Add mode:  start/end dates pre-filled from the slot the user clicked,
 *            or defaults to today→today+30d when invoked from the header
 *            "Add project" button.
 * Edit mode: pre-fills every field; offers Save / Delete (soft-delete).
 *
 * Validation:
 *   - name required
 *   - start_date and end_date required, end must be ≥ start
 *
 * Stage 'completed' bubbles the project into the Completed projects tray
 * on the /projects page. completed_at is managed in lib/db.dbUpdateProject
 * so the modal doesn't need to set it.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Project, ProjectTeam, ProjectStage } from '@/lib/data';
import { generateId, PROJECT_TEAMS, PROJECT_STAGES } from '@/lib/data';
import { dbCreateProject, dbUpdateProject, dbDeleteProject } from '@/lib/db';
import SubmitButton from './SubmitButton';

/** Unwrap a thrown value into a human-readable string. Handles three
 *  shapes: native Error, Supabase error ({ message, details, hint, code }),
 *  and anything else (fall back to JSON). Without this, Supabase errors
 *  stringify as "[object Object]" and the real cause hides. */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint, e.code ? `(code ${e.code})` : null].filter(Boolean);
    if (parts.length) return parts.join(' — ');
    try { return JSON.stringify(err); } catch { return String(err); }
  }
  return String(err);
}

interface Props {
  /** When set, edit that project. Otherwise create new. */
  editing?: Project | null;
  /** Pre-fill values for new project (when adding via header button). */
  defaultStartDate: string;   // YYYY-MM-DD
  defaultEndDate: string;     // YYYY-MM-DD
  defaultTeam?: ProjectTeam;
  onClose: () => void;
  /** Called after a successful save/delete so the parent can refresh. */
  onChanged: () => void;
}

export default function ProjectModal({ editing, defaultStartDate, defaultEndDate, defaultTeam, onClose, onChanged }: Props) {
  const { data: session } = useSession();
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [team, setTeam] = useState<ProjectTeam>(editing?.team ?? defaultTeam ?? 'other');
  const [stage, setStage] = useState<ProjectStage>(editing?.stage ?? 'planning');
  const [startDate, setStartDate] = useState<string>(editing?.startDate ?? defaultStartDate);
  const [endDate, setEndDate] = useState<string>(editing?.endDate ?? defaultEndDate);
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
    if (!startDate || !endDate) { setError('Start and end dates are required.'); return; }
    if (endDate < startDate) { setError('End date must be on or after the start date.'); return; }

    setSubmitting(true);
    try {
      if (editing) {
        await dbUpdateProject(editing.id, {
          name: trimmedName,
          description: description.trim() || undefined,
          team,
          stage,
          startDate,
          endDate,
        });
      } else {
        await dbCreateProject({
          id: generateId(),
          name: trimmedName,
          description: description.trim() || undefined,
          team,
          stage,
          startDate,
          endDate,
          // completed_at is auto-managed in dbUpdateProject; on create we
          // stamp it ourselves if the user picked 'completed' right away.
          completedAt: stage === 'completed' ? new Date().toISOString() : null,
          sortOrder: 9999, // append at bottom; reorder UI re-numbers in 0..N.
          ownerId: session?.user?.id ?? '',
        });
      }
      onChanged();
      onClose();
    } catch (err) {
      // Supabase errors are plain objects `{ message, details, hint, code }`
      // — not `Error` instances. `String(err)` would print "[object Object]"
      // and hide the actual reason. extractErrorMessage unwraps both cases.
      const msg = extractErrorMessage(err);
      console.error('ProjectModal save failed:', err);
      setError(`Save failed: ${msg}`);
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm(`Delete "${editing.name}"?\nThis archives the project. It can be restored from the database if needed.`)) return;
    setSubmitting(true);
    try {
      await dbDeleteProject(editing.id);
      onChanged();
      onClose();
    } catch (err) {
      const msg = extractErrorMessage(err);
      console.error('ProjectModal delete failed:', err);
      setError(`Delete failed: ${msg}`);
      setSubmitting(false);
    }
  }

  /** One-click "Mark as completed" / "Reopen". Toggles between completed
   *  and the previous stage (defaults to 'in_progress' when reopening a
   *  finished project). completed_at is auto-managed in lib/db. */
  async function handleToggleComplete() {
    if (!editing) return;
    setError(null);
    setSubmitting(true);
    const next: ProjectStage = editing.stage === 'completed' ? 'in_progress' : 'completed';
    try {
      await dbUpdateProject(editing.id, { stage: next });
      onChanged();
      onClose();
    } catch (err) {
      const msg = extractErrorMessage(err);
      console.error('ProjectModal toggle complete failed:', err);
      setError(`Failed to update: ${msg}`);
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
            {editing ? 'Edit project' : 'Add project'}
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
              Project name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. LIPIDOL 2.0 Launch"
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
              placeholder="Scope, deliverables, key contacts…"
              rows={3}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Team <span className="text-red-500">*</span>
              </label>
              <select
                value={team}
                onChange={(e) => setTeam(e.target.value as ProjectTeam)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {PROJECT_TEAMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Stage <span className="text-red-500">*</span>
              </label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as ProjectStage)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {PROJECT_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Start date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Deadline <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {error && (
            <div role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* "Mark as completed" shortcut — only relevant in edit mode.
              Sits as its own row above the standard footer so the
              "celebration" action gets visual weight, and so users don't
              have to dig into the Stage dropdown for the single most
              common state change. Toggles back to "Reopen" once done. */}
          {editing && (
            <div className="pt-1">
              <button
                type="button"
                onClick={handleToggleComplete}
                disabled={submitting}
                className={`w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50 ${
                  editing.stage === 'completed'
                    ? 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/30'
                    : 'border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300 dark:hover:bg-green-950/30'
                }`}
              >
                {editing.stage === 'completed' ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a4 4 0 014 4v0a4 4 0 01-4 4H7M3 10l4-4m-4 4l4 4" /></svg>
                    Reopen project
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" /></svg>
                    Mark as completed
                  </>
                )}
              </button>
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
