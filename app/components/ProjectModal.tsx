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
import type { Project, ProjectTeam, ProjectStage, ProjectTask, ProjectSubBar } from '@/lib/data';
import { generateId, PROJECT_TEAMS, PROJECT_STAGES } from '@/lib/data';

/**
 * Parse a free-text description for inline status markers users have
 * been writing as a workaround ("Material prep - done" / "Test - in
 * progress"). Returns the inferred checklist for one-click conversion
 * via the "Convert description to checklist" button.
 */
function inferTasksFromDescription(desc: string): ProjectTask[] {
  if (!desc) return [];
  const lines = desc.split('\n').map((l) => l.trim()).filter(Boolean);
  // Only convert if at least 2 lines look "checklist-y" — avoids a
  // false-positive button on plain prose. A line is "checklist-y" when
  // it ends with a status keyword, is short, or starts with a bullet.
  const doneRe = /\s[-–—:]?\s*(done|complete[d]?|finished|✓)\s*$/i;
  const wipRe = /\s[-–—:]?\s*(in progress|wip|ongoing|진행\s*중|진행중)\s*$/i;
  const bulletRe = /^[-•*]\s*/;
  const tasks: ProjectTask[] = [];
  let signal = 0;
  for (const raw of lines) {
    let label = raw.replace(bulletRe, '');
    const isDone = doneRe.test(label);
    const isWip = wipRe.test(label);
    label = label.replace(doneRe, '').replace(wipRe, '').trim();
    if (!label) continue;
    if (isDone || isWip || bulletRe.test(raw) || label.length < 60) signal++;
    tasks.push({
      id: generateId(),
      label,
      done: isDone,
      doneAt: isDone ? new Date().toISOString() : null,
    });
  }
  return signal >= 2 ? tasks : [];
}
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
  const [tasks, setTasks] = useState<ProjectTask[]>(editing?.tasks ?? []);
  const [newTaskLabel, setNewTaskLabel] = useState('');
  const [subBars, setSubBars] = useState<ProjectSubBar[]>(editing?.subBars ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One-shot suggestion: if the existing description looks like a manual
  // status list ("X - done"), surface a button to convert it to checklist.
  const inferredTasks = editing && tasks.length === 0
    ? inferTasksFromDescription(description)
    : [];

  function addTask() {
    const label = newTaskLabel.trim();
    if (!label) return;
    setTasks((prev) => [...prev, { id: generateId(), label, done: false, doneAt: null }]);
    setNewTaskLabel('');
  }
  function toggleTask(id: string) {
    setTasks((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const nextDone = !t.done;
      return { ...t, done: nextDone, doneAt: nextDone ? new Date().toISOString() : null };
    }));
  }
  function deleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }
  function updateTaskLabel(id: string, label: string) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, label } : t)));
  }
  function moveTask(id: string, dir: -1 | 1) {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const swap = idx + dir;
      if (swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }
  const completedCount = tasks.filter((t) => t.done).length;
  const progressPct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  // ── Sub-bar (phase) handlers ──────────────────────────────────────
  function addSubBar() {
    setSubBars((prev) => [...prev, {
      id: generateId(),
      label: '',
      // Default to inheriting the parent's range so the row stays
      // within the parent bar by default. User can edit dates.
      startDate: startDate || new Date().toISOString().split('T')[0],
      endDate: endDate || new Date().toISOString().split('T')[0],
      done: false,
    }]);
  }
  function updateSubBar(id: string, patch: Partial<ProjectSubBar>) {
    setSubBars((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function deleteSubBar(id: string) {
    setSubBars((prev) => prev.filter((s) => s.id !== id));
  }
  function moveSubBar(id: string, dir: -1 | 1) {
    setSubBars((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx === -1) return prev;
      const swap = idx + dir;
      if (swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

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
          tasks,
          subBars,
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
          tasks,
          subBars,
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
            {inferredTasks.length > 0 && (
              <button
                type="button"
                onClick={() => { setTasks(inferredTasks); setDescription(''); }}
                className="mt-2 text-xs text-blue-700 dark:text-blue-300 hover:underline"
                title="Detected status markers in description — convert to checkboxes"
              >
                Convert {inferredTasks.length} line{inferredTasks.length === 1 ? '' : 's'} to checklist →
              </button>
            )}
          </div>

          {/* Checklist of sub-steps */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Checklist <span className="text-gray-400 dark:text-gray-500 text-xs">(optional)</span>
              </label>
              {tasks.length > 0 && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {completedCount} / {tasks.length} done · {progressPct}%
                </span>
              )}
            </div>
            {tasks.length > 0 && (
              <div className="mb-2 h-1.5 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}
            <ul className="space-y-1">
              {tasks.map((t, i) => (
                <li key={t.id} className="flex items-center gap-2 group">
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={() => toggleTask(t.id)}
                    className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer flex-shrink-0"
                  />
                  <input
                    type="text"
                    value={t.label}
                    onChange={(e) => updateTaskLabel(t.id, e.target.value)}
                    className={
                      'flex-1 bg-transparent text-sm border border-transparent rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-400 ' +
                      (t.done ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-100')
                    }
                  />
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 text-xs">
                    <button type="button" onClick={() => moveTask(t.id, -1)} disabled={i === 0}
                      className="w-5 h-5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30" title="Move up">↑</button>
                    <button type="button" onClick={() => moveTask(t.id, 1)} disabled={i === tasks.length - 1}
                      className="w-5 h-5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30" title="Move down">↓</button>
                    <button type="button" onClick={() => deleteTask(t.id)}
                      className="w-5 h-5 text-gray-400 hover:text-red-600" title="Remove">×</button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={newTaskLabel}
                onChange={(e) => setNewTaskLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }}
                placeholder="Add a step and press Enter…"
                className="flex-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                type="button"
                onClick={addTask}
                disabled={!newTaskLabel.trim()}
                className="px-3 py-1.5 text-sm text-white bg-gray-800 dark:bg-slate-700 rounded-lg hover:bg-gray-700 dark:hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>

          {/* Sub-bars (timeline phases) — render thin bars on Gantt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Phases <span className="text-gray-400 dark:text-gray-500 text-xs">(optional · timeline sub-bars)</span>
              </label>
              <button
                type="button"
                onClick={addSubBar}
                className="text-xs text-blue-700 dark:text-blue-300 hover:underline"
              >
                + Add phase
              </button>
            </div>
            {subBars.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Break the project into time-bound phases (Material Prep → Test → Analysis).
                They appear as thin bars under the parent in the Gantt.
              </p>
            )}
            <ul className="space-y-1.5">
              {subBars.map((s, i) => (
                <li key={s.id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-2 group">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!s.done}
                      onChange={(e) => updateSubBar(s.id, { done: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer flex-shrink-0"
                      title="Mark phase complete"
                    />
                    <input
                      type="text"
                      value={s.label}
                      onChange={(e) => updateSubBar(s.id, { label: e.target.value })}
                      placeholder="Phase name (e.g. Material Prep)"
                      className={
                        'flex-1 bg-transparent text-sm border border-transparent rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-400 ' +
                        (s.done ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-100')
                      }
                    />
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 text-xs">
                      <button type="button" onClick={() => moveSubBar(s.id, -1)} disabled={i === 0}
                        className="w-5 h-5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30" title="Move up">↑</button>
                      <button type="button" onClick={() => moveSubBar(s.id, 1)} disabled={i === subBars.length - 1}
                        className="w-5 h-5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30" title="Move down">↓</button>
                      <button type="button" onClick={() => deleteSubBar(s.id)}
                        className="w-5 h-5 text-gray-400 hover:text-red-600" title="Remove">×</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-1.5">
                    <input
                      type="date"
                      value={s.startDate}
                      onChange={(e) => updateSubBar(s.id, { startDate: e.target.value })}
                      className="w-full border border-gray-200 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                      title="Start date"
                    />
                    <input
                      type="date"
                      value={s.endDate}
                      onChange={(e) => updateSubBar(s.id, { endDate: e.target.value })}
                      className="w-full border border-gray-200 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                      title="End date"
                    />
                  </div>
                </li>
              ))}
            </ul>
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

          {editing && (
            <button
              type="button"
              onClick={handleToggleComplete}
              disabled={submitting}
              className={
                'w-full py-2 text-sm font-medium rounded-lg border transition-colors ' +
                (editing.stage === 'completed'
                  ? 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/30'
                  : 'border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300 dark:hover:bg-green-950/30')
              }
            >
              {editing.stage === 'completed' ? '↻ Reopen project' : '✓ Mark as completed'}
            </button>
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
