'use client';

/**
 * Trial Tracker — the CRM-internal version of the marketing team's
 * monogastric-trials.vercel.app workspace. Three views, one data source
 * (data-migration/36-trials.sql):
 *
 *   1. Trial tracker  — ongoing trials with each trial's LATEST update
 *                       as a card. Grouped by animal group → phase.
 *   2. Weekly history — every update ever, grouped by trial, newest
 *                       update first. Includes finished trials.
 *   3. Weekly report  — one picked reporting week's updates only,
 *                       finished trials excluded, grouped like (1).
 *                       "Print / Save PDF" opens the browser print
 *                       dialog with a print-friendly stylesheet.
 *
 * Replaces the old /projects Gantt tracker — the Project Tracker
 * route, page component, modal, and `projects` table were all
 * removed in the same change (see data-migration/36 CASCADE drop
 * and app/projects deletion).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';
import {
  Trial, TrialUpdate, AnimalGroup, TrialStage, TrialHealth,
  TRIAL_STAGES, TRIAL_HEALTHS, PHASES_BY_GROUP,
  listTrials, listUpdates, upsertTrial, upsertUpdate,
  finishTrial, reopenTrial, deleteTrial, deleteUpdate,
  wednesdayOf, recentWeekEndings, formatWeekEnding,
} from '@/lib/trials';

const ANIMAL_GROUPS: AnimalGroup[] = ['Poultry', 'Swine', 'Poultry/Swine', 'Ruminants', 'LATAM'];

type Tab = 'tracker' | 'history' | 'report';

export default function TrialsPage() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? '';

  const [tab, setTab] = useState<Tab>('tracker');
  const [trials, setTrials] = useState<Trial[]>([]);
  const [updates, setUpdates] = useState<TrialUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<'all' | AnimalGroup>('all');
  const [weekEnding, setWeekEnding] = useState<string>(wednesdayOf());
  const [showFinished, setShowFinished] = useState(false);

  const [trialModal, setTrialModal] = useState<Trial | null>(null); // null-but-open distinguished by boolean below
  const [trialModalOpen, setTrialModalOpen] = useState(false);
  const [updateModal, setUpdateModal] = useState<{ trialId?: string; update?: TrialUpdate } | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [t, u] = await Promise.all([listTrials(), listUpdates()]);
      setTrials(t); setUpdates(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Index: latest update per trial id. Used by the tracker view and
  // for card colouring on the sidebar.
  const latestByTrial = useMemo(() => {
    const map = new Map<string, TrialUpdate>();
    for (const u of updates) {
      const prev = map.get(u.trialId);
      if (!prev || u.weekEnding > prev.weekEnding) map.set(u.trialId, u);
    }
    return map;
  }, [updates]);

  // All week-ending dates present in the data, newest first, used
  // in the Weekly report picker. We blend recent Wednesdays so a
  // brand-new install still has usable choices.
  const weekOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of updates) set.add(u.weekEnding);
    for (const w of recentWeekEndings(12)) set.add(w);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [updates]);

  // ── Filtering ────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  function matchesSearch(trial: Trial, u?: TrialUpdate): boolean {
    if (!q) return true;
    if (trial.name.toLowerCase().includes(q)) return true;
    if (trial.phase.toLowerCase().includes(q)) return true;
    if (u) {
      if ((u.owner || '').toLowerCase().includes(q)) return true;
      if ((u.whatHappened || '').toLowerCase().includes(q)) return true;
      if ((u.nextStep || '').toLowerCase().includes(q)) return true;
      if ((u.stage || '').toLowerCase().includes(q)) return true;
    }
    return false;
  }
  function matchesGroup(trial: Trial): boolean {
    return groupFilter === 'all' || trial.animalGroup === groupFilter;
  }

  // Trial tracker view data: ongoing (or finished too, by toggle), grouped by group→phase.
  const trackerGroups = useMemo(() => groupByGroupAndPhase(
    trials
      .filter((t) => showFinished ? true : !t.finishedAt)
      .filter(matchesGroup)
      .filter((t) => matchesSearch(t, latestByTrial.get(t.id)))
  ), [trials, showFinished, groupFilter, q, latestByTrial]);

  // Weekly report view data: only updates with weekEnding == picked
  // date, trial not finished.
  const reportRows = useMemo(() => {
    const out: { trial: Trial; update: TrialUpdate }[] = [];
    for (const u of updates) {
      if (u.weekEnding !== weekEnding) continue;
      const trial = trials.find((t) => t.id === u.trialId);
      if (!trial) continue;
      if (trial.finishedAt) continue;
      if (!matchesGroup(trial)) continue;
      if (!matchesSearch(trial, u)) continue;
      out.push({ trial, update: u });
    }
    return groupByGroupAndPhasePairs(out);
  }, [updates, trials, weekEnding, groupFilter, q]);

  // Weekly history: every update, trial by trial.
  const historyByTrial = useMemo(() => {
    const map = new Map<string, TrialUpdate[]>();
    for (const u of updates) {
      const arr = map.get(u.trialId) || [];
      arr.push(u);
      map.set(u.trialId, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => b.weekEnding.localeCompare(a.weekEnding));
    return trials
      .filter(matchesGroup)
      .filter((t) => matchesSearch(t, (map.get(t.id) || [])[0]))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ trial: t, updates: map.get(t.id) || [] }));
  }, [updates, trials, groupFilter, q]);

  const greenCount  = reportRows.flat.filter((r) => r.update.health === 'Green').length;
  const amberRedCount = reportRows.flat.filter((r) => r.update.health === 'Amber' || r.update.health === 'Red').length;

  // ── Mutations ────────────────────────────────────────────────
  async function handleSaveTrial(patch: Partial<Trial> & { name: string; animalGroup: AnimalGroup; phase: string }) {
    try {
      await upsertTrial({ ...patch, createdBy: patch.id ? undefined : userId });
      await load();
      setTrialModalOpen(false); setTrialModal(null);
      setToast(patch.id ? 'Trial updated' : `Added "${patch.name}"`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function handleSaveUpdate(patch: Partial<TrialUpdate> & {
    trialId: string; weekEnding: string; stage: TrialStage; health: TrialHealth;
  }) {
    try {
      await upsertUpdate({ ...patch, createdBy: patch.id ? undefined : userId });
      await load();
      setUpdateModal(null);
      setToast(patch.id ? 'Update saved' : 'Weekly update added');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function handleFinish(t: Trial) {
    if (!confirm(`Mark "${t.name}" as finished? It will be hidden from the Weekly Report.`)) return;
    try { await finishTrial(t.id); await load(); setToast('Trial finished'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function handleReopen(t: Trial) {
    try { await reopenTrial(t.id); await load(); setToast('Trial reopened'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function handleDeleteTrial(t: Trial) {
    if (!confirm(`Delete "${t.name}" and ALL of its weekly updates? This cannot be undone.`)) return;
    try { await deleteTrial(t.id); await load(); setToast(`Deleted "${t.name}"`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function handleDeleteUpdate(u: TrialUpdate) {
    if (!confirm(`Delete the ${formatWeekEnding(u.weekEnding)} update?`)) return;
    try { await deleteUpdate(u.id); await load(); setToast('Update deleted'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <>
      <TopBar />
      <PrintStyles />
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950 pt-16">
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 py-6">
          {/* Page header + global actions */}
          <div className="mb-4 flex items-start justify-between flex-wrap gap-3 print:hidden">
            <div>
              <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Research &amp; Development</p>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Trial tracker</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Enter weekly trial updates, keep searchable history, and generate the trial section of the weekly report — all in one place.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setTrialModal(null); setTrialModalOpen(true); }}
                className="text-sm px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 font-medium">
                + New trial
              </button>
              <button
                onClick={() => setUpdateModal({})}
                className="text-sm px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium">
                + Add weekly update
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-gray-200 dark:border-slate-800 print:hidden">
            {([
              ['tracker', 'Trial tracker', `${trials.filter((t) => !t.finishedAt).length} ongoing`],
              ['history', 'Weekly history', `${updates.length} updates`],
              ['report',  'Weekly report',  `week ending ${formatWeekEnding(weekEnding)}`],
            ] as [Tab, string, string][]).map(([key, label, sub]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all ${
                  tab === key
                    ? 'bg-white dark:bg-slate-900 border border-b-0 border-gray-200 dark:border-slate-800 text-emerald-700 dark:text-emerald-400 -mb-px'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}>
                {label} <span className="text-[11px] text-gray-400 ml-1">· {sub}</span>
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-3 p-3 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">
              {error}
              <button onClick={() => setError(null)} className="float-right text-xs opacity-70 hover:opacity-100">×</button>
            </div>
          )}

          {/* Filter bar — shared across tabs */}
          <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search trials or updates…"
              className="flex-1 min-w-[180px] border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value as 'all' | AnimalGroup)}
              className="border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
              <option value="all">All animal groups</option>
              {ANIMAL_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            {tab === 'tracker' && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={showFinished} onChange={(e) => setShowFinished(e.target.checked)} />
                Show finished
              </label>
            )}
            {tab === 'report' && (
              <>
                <label className="text-xs text-gray-500 dark:text-gray-400">Week ending</label>
                <select value={weekEnding} onChange={(e) => setWeekEnding(e.target.value)}
                  className="border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
                  {weekOptions.map((w) => <option key={w} value={w}>{formatWeekEnding(w)}</option>)}
                </select>
                <button onClick={() => window.print()}
                  className="text-sm px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-900 text-white font-medium">
                  Print / Save PDF
                </button>
              </>
            )}
          </div>

          {loading ? (
            <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
          ) : (
            <>
              {tab === 'tracker' && (
                <TrackerView
                  groups={trackerGroups}
                  latestByTrial={latestByTrial}
                  onEditTrial={(t) => { setTrialModal(t); setTrialModalOpen(true); }}
                  onAddUpdate={(trialId) => setUpdateModal({ trialId })}
                  onFinish={handleFinish}
                  onReopen={handleReopen}
                  onDeleteTrial={handleDeleteTrial}
                  onToggleHistory={(id) => setExpandedHistory((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                  expandedHistory={expandedHistory}
                  updates={updates}
                  onEditUpdate={(u) => setUpdateModal({ update: u })}
                  onDeleteUpdate={handleDeleteUpdate}
                />
              )}
              {tab === 'history' && (
                <HistoryView
                  rows={historyByTrial}
                  expanded={expandedHistory}
                  onToggle={(id) => setExpandedHistory((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                  onEditUpdate={(u) => setUpdateModal({ update: u })}
                  onDeleteUpdate={handleDeleteUpdate}
                />
              )}
              {tab === 'report' && (
                <ReportView
                  weekEnding={weekEnding}
                  groups={reportRows.groups}
                  totalCount={reportRows.flat.length}
                  greenCount={greenCount}
                  amberRedCount={amberRedCount}
                />
              )}
            </>
          )}
        </div>

        {trialModalOpen && (
          <TrialModal
            initial={trialModal}
            onClose={() => { setTrialModalOpen(false); setTrialModal(null); }}
            onSave={handleSaveTrial}
          />
        )}
        {updateModal && (
          <UpdateModal
            trials={trials.filter((t) => !t.finishedAt || updateModal.update?.trialId === t.id)}
            initialTrialId={updateModal.trialId}
            initial={updateModal.update}
            defaultWeekEnding={weekEnding}
            onClose={() => setUpdateModal(null)}
            onSave={handleSaveUpdate}
          />
        )}
        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      </div>
    </>
  );
}

// ── Grouping helpers ──────────────────────────────────────────
type TrackerGroup = {
  animalGroup: AnimalGroup;
  phases: { phase: string; trials: Trial[] }[];
};
function groupByGroupAndPhase(ts: Trial[]): TrackerGroup[] {
  const byGroup = new Map<AnimalGroup, Map<string, Trial[]>>();
  for (const t of ts) {
    const g = byGroup.get(t.animalGroup) || new Map<string, Trial[]>();
    const arr = g.get(t.phase) || [];
    arr.push(t);
    g.set(t.phase, arr);
    byGroup.set(t.animalGroup, g);
  }
  const order: AnimalGroup[] = ['Poultry', 'Swine', 'Poultry/Swine', 'Ruminants', 'LATAM'];
  return order
    .filter((g) => byGroup.has(g))
    .map((g) => ({
      animalGroup: g,
      phases: Array.from(byGroup.get(g)!.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([phase, trials]) => ({ phase, trials: trials.sort((a, b) => a.name.localeCompare(b.name)) })),
    }));
}

type ReportGroup = {
  animalGroup: AnimalGroup;
  phases: { phase: string; items: { trial: Trial; update: TrialUpdate }[] }[];
};
function groupByGroupAndPhasePairs(
  pairs: { trial: Trial; update: TrialUpdate }[],
): { groups: ReportGroup[]; flat: { trial: Trial; update: TrialUpdate }[] } {
  const byGroup = new Map<AnimalGroup, Map<string, { trial: Trial; update: TrialUpdate }[]>>();
  for (const p of pairs) {
    const g = byGroup.get(p.trial.animalGroup) || new Map();
    const arr = g.get(p.trial.phase) || [];
    arr.push(p);
    g.set(p.trial.phase, arr);
    byGroup.set(p.trial.animalGroup, g);
  }
  const order: AnimalGroup[] = ['Poultry', 'Swine', 'Poultry/Swine', 'Ruminants', 'LATAM'];
  const groups = order
    .filter((g) => byGroup.has(g))
    .map((g) => ({
      animalGroup: g,
      phases: Array.from(byGroup.get(g)!.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([phase, items]) => ({ phase, items: items.sort((a, b) => a.trial.name.localeCompare(b.trial.name)) })),
    }));
  return { groups, flat: pairs };
}

// ── Shared bits ───────────────────────────────────────────────
const HEALTH_META: Record<TrialHealth, string> = {
  Green:  'bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800',
  Amber:  'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  Red:    'bg-red-100 text-red-800 border border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800',
};
function HealthPill({ health }: { health: TrialHealth }) {
  return <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded ${HEALTH_META[health]}`}>{health}</span>;
}

function UpdateCard({ trial, update, onAddUpdate, onFinish, onReopen, onEditTrial, onDeleteTrial, onEditUpdate, onDeleteUpdate }: {
  trial: Trial;
  update: TrialUpdate | undefined;
  onAddUpdate: () => void;
  onFinish: () => void;
  onReopen: () => void;
  onEditTrial: () => void;
  onDeleteTrial: () => void;
  onEditUpdate?: (u: TrialUpdate) => void;
  onDeleteUpdate?: (u: TrialUpdate) => void;
}) {
  const finished = !!trial.finishedAt;
  return (
    <article className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{trial.name}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {trial.animalGroup} · {trial.phase}
            {update && <> · <span className="text-gray-400">updated {formatWeekEnding(update.weekEnding)}</span></>}
            {finished && <> · <span className="text-amber-700">Finished</span></>}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onAddUpdate}
            className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-medium">+ Weekly update</button>
          {finished
            ? <button onClick={onReopen} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800">Reopen</button>
            : <button onClick={onFinish} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800">Finish</button>}
          <button onClick={onEditTrial} title="Edit trial" className="text-xs px-1.5 py-1 rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-100">✎</button>
          <button onClick={onDeleteTrial} title="Delete trial" className="text-xs px-1.5 py-1 rounded text-red-500 hover:bg-red-50">🗑</button>
        </div>
      </header>
      <div className="p-4">
        {!update ? (
          <p className="text-sm text-gray-400 italic">No weekly updates yet — click <span className="font-medium">+ Weekly update</span>.</p>
        ) : (
          <UpdateBody update={update} onEdit={onEditUpdate ? () => onEditUpdate(update) : undefined} onDelete={onDeleteUpdate ? () => onDeleteUpdate(update) : undefined} />
        )}
      </div>
    </article>
  );
}

function UpdateBody({ update, onEdit, onDelete, compact = false }: {
  update: TrialUpdate;
  onEdit?: () => void;
  onDelete?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? '' : ''}>
      <div className="flex items-center flex-wrap gap-2 mb-3">
        <HealthPill health={update.health} />
        <span className="text-[11px] text-gray-500 dark:text-gray-400">{update.stage}</span>
        {update.owner && <span className="text-[11px] text-gray-500 dark:text-gray-400">· Owner: {update.owner}</span>}
        {update.dueDate && <span className="text-[11px] text-gray-500 dark:text-gray-400">· Due {formatWeekEnding(update.dueDate)}</span>}
        {(onEdit || onDelete) && <span className="ml-auto flex items-center gap-1 print:hidden">
          {onEdit && <button onClick={onEdit} className="text-[11px] text-gray-500 hover:text-emerald-700">Edit</button>}
          {onDelete && <button onClick={onDelete} className="text-[11px] text-red-500 hover:text-red-700">Delete</button>}
        </span>}
      </div>
      {update.whatHappened && (
        <div className="mb-2">
          <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">What happened this week</p>
          <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{update.whatHappened}</p>
        </div>
      )}
      {update.nextStep && (
        <div>
          <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Next step</p>
          <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{update.nextStep}</p>
        </div>
      )}
    </div>
  );
}

// ── Tracker view ──────────────────────────────────────────────
function TrackerView({
  groups, latestByTrial, onAddUpdate, onFinish, onReopen, onEditTrial, onDeleteTrial,
  onToggleHistory, expandedHistory, updates, onEditUpdate, onDeleteUpdate,
}: {
  groups: TrackerGroup[];
  latestByTrial: Map<string, TrialUpdate>;
  onAddUpdate: (trialId: string) => void;
  onFinish: (t: Trial) => void;
  onReopen: (t: Trial) => void;
  onEditTrial: (t: Trial) => void;
  onDeleteTrial: (t: Trial) => void;
  onToggleHistory: (id: string) => void;
  expandedHistory: Set<string>;
  updates: TrialUpdate[];
  onEditUpdate: (u: TrialUpdate) => void;
  onDeleteUpdate: (u: TrialUpdate) => void;
}) {
  if (groups.length === 0) {
    return <div className="py-10 text-center text-sm text-gray-400 italic">No trials match. Add one with <span className="font-medium">+ New trial</span>.</div>;
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.animalGroup}>
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2 uppercase tracking-wider">{g.animalGroup}</h2>
          {g.phases.map((p) => (
            <div key={p.phase} className="mb-4">
              <h3 className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2">{p.phase}</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {p.trials.map((t) => {
                  const latest = latestByTrial.get(t.id);
                  const history = updates.filter((u) => u.trialId === t.id && (!latest || u.id !== latest.id))
                    .sort((a, b) => b.weekEnding.localeCompare(a.weekEnding));
                  const open = expandedHistory.has(t.id);
                  return (
                    <div key={t.id}>
                      <UpdateCard
                        trial={t} update={latest}
                        onAddUpdate={() => onAddUpdate(t.id)}
                        onFinish={() => onFinish(t)}
                        onReopen={() => onReopen(t)}
                        onEditTrial={() => onEditTrial(t)}
                        onDeleteTrial={() => onDeleteTrial(t)}
                        onEditUpdate={onEditUpdate}
                        onDeleteUpdate={onDeleteUpdate}
                      />
                      {history.length > 0 && (
                        <div className="mt-1">
                          <button onClick={() => onToggleHistory(t.id)}
                            className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
                            {open ? '▼ Hide' : '▶ View'} history ({history.length})
                          </button>
                          {open && (
                            <div className="mt-2 pl-3 border-l-2 border-gray-200 dark:border-slate-700 space-y-3">
                              {history.map((u) => (
                                <div key={u.id} className="bg-gray-50 dark:bg-slate-900/50 rounded-lg p-3">
                                  <p className="text-[11px] text-gray-500 mb-2">{formatWeekEnding(u.weekEnding)}</p>
                                  <UpdateBody update={u}
                                    onEdit={() => onEditUpdate(u)}
                                    onDelete={() => onDeleteUpdate(u)}
                                    compact />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ── History view ──────────────────────────────────────────────
function HistoryView({ rows, expanded, onToggle, onEditUpdate, onDeleteUpdate }: {
  rows: { trial: Trial; updates: TrialUpdate[] }[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onEditUpdate: (u: TrialUpdate) => void;
  onDeleteUpdate: (u: TrialUpdate) => void;
}) {
  if (rows.length === 0) return <div className="py-10 text-center text-sm text-gray-400 italic">No trials match.</div>;
  return (
    <div className="space-y-2">
      {rows.map(({ trial, updates }) => {
        const open = expanded.has(trial.id);
        return (
          <div key={trial.id} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
            <button onClick={() => onToggle(trial.id)}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{trial.name}</p>
                <p className="text-[11px] text-gray-500">{trial.animalGroup} / {trial.phase}{trial.finishedAt ? ' · Finished' : ''}</p>
              </div>
              <span className="text-[11px] text-gray-400 whitespace-nowrap">{updates.length} updates</span>
              <span className="text-xs text-gray-400">{open ? '▼' : '▶'}</span>
            </button>
            {open && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-slate-800 space-y-3">
                {updates.length === 0 && (
                  <p className="text-xs text-gray-400 italic py-2">No updates recorded yet.</p>
                )}
                {updates.map((u) => (
                  <div key={u.id} className="bg-gray-50 dark:bg-slate-900/40 rounded-lg p-3">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-2">{formatWeekEnding(u.weekEnding)}</p>
                    <UpdateBody update={u}
                      onEdit={() => onEditUpdate(u)}
                      onDelete={() => onDeleteUpdate(u)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Report view ───────────────────────────────────────────────
function ReportView({ weekEnding, groups, totalCount, greenCount, amberRedCount }: {
  weekEnding: string;
  groups: ReportGroup[];
  totalCount: number; greenCount: number; amberRedCount: number;
}) {
  return (
    <div id="print-area" className="space-y-5">
      <header className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 print:border-0 print:p-0">
        <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Weekly report</p>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Week ending {formatWeekEnding(weekEnding)}</h2>
        <p className="text-xs text-gray-500 mt-0.5">Finished trials are excluded.</p>
        <div className="mt-3 flex items-center gap-4">
          <Stat n={totalCount} label="Updates" />
          <Stat n={greenCount} label="Green" tone="green" />
          <Stat n={amberRedCount} label="Amber / Red" tone="amber" />
        </div>
      </header>
      {groups.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400 italic">No updates for this week yet.</div>
      ) : (
        groups.map((g) => (
          <section key={g.animalGroup} className="print:break-inside-avoid">
            <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2 uppercase tracking-wider">{g.animalGroup}</h2>
            {g.phases.map((p) => (
              <div key={p.phase} className="mb-4">
                <h3 className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2">{p.phase}</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 print:grid-cols-1">
                  {p.items.map(({ trial, update }) => (
                    <article key={trial.id} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4 print:break-inside-avoid">
                      <header className="mb-2">
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{trial.name}</h4>
                      </header>
                      <UpdateBody update={update} />
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'green' | 'amber' }) {
  const cls = tone === 'green'
    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300'
    : tone === 'amber'
    ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300'
    : 'bg-gray-50 text-gray-800 border border-gray-200 dark:bg-slate-800 dark:text-gray-200';
  return (
    <div className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${cls}`}>
      <span className="text-base font-bold mr-1">{n}</span>{label}
    </div>
  );
}

// ── Trial modal ───────────────────────────────────────────────
function TrialModal({ initial, onClose, onSave }: {
  initial: Trial | null;
  onClose: () => void;
  onSave: (patch: Partial<Trial> & { name: string; animalGroup: AnimalGroup; phase: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [animalGroup, setAnimalGroup] = useState<AnimalGroup>(initial?.animalGroup ?? 'Poultry');
  const [phase, setPhase] = useState<string>(initial?.phase ?? PHASES_BY_GROUP['Poultry'][0]);

  useEffect(() => {
    // When switching animal group, snap the phase to the first valid option
    // for that group unless we were editing an existing matching trial.
    const options = PHASES_BY_GROUP[animalGroup];
    if (!options.includes(phase)) setPhase(options[0]);
  }, [animalGroup, phase]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ id: initial?.id, name, animalGroup, phase });
  }

  return (
    <ModalShell title={initial ? 'Edit trial' : 'Add a trial'}
      subtitle="Set up the trial once, then add an update each reporting week."
      onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Trial name" required>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder="e.g. Kalmbach Enncinate/Barrier Trial"
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Animal group">
            <select value={animalGroup} onChange={(e) => setAnimalGroup(e.target.value as AnimalGroup)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
              {ANIMAL_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Phase / species">
            <select value={phase} onChange={(e) => setPhase(e.target.value)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
              {PHASES_BY_GROUP[animalGroup].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-[11px] text-gray-500">Choose Poultry/Swine for a trial that covers both animal groups. New trials begin as ongoing.</p>
        <ModalFooter onCancel={onClose} submitLabel={initial ? 'Save trial' : 'Save trial'} />
      </form>
    </ModalShell>
  );
}

// ── Update modal ──────────────────────────────────────────────
function UpdateModal({ trials, initialTrialId, initial, defaultWeekEnding, onClose, onSave }: {
  trials: Trial[];
  initialTrialId?: string;
  initial?: TrialUpdate;
  defaultWeekEnding: string;
  onClose: () => void;
  onSave: (patch: Partial<TrialUpdate> & { trialId: string; weekEnding: string; stage: TrialStage; health: TrialHealth }) => void;
}) {
  const [trialId, setTrialId] = useState(initial?.trialId ?? initialTrialId ?? (trials[0]?.id ?? ''));
  const [weekEnding, setWeekEnding] = useState(initial?.weekEnding ?? defaultWeekEnding);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [stage, setStage] = useState<TrialStage>(initial?.stage ?? 'Active Trial');
  const [health, setHealth] = useState<TrialHealth>(initial?.health ?? 'Green');
  const [owner, setOwner] = useState(initial?.owner ?? '');
  const [whatHappened, setWhatHappened] = useState(initial?.whatHappened ?? '');
  const [nextStep, setNextStep] = useState(initial?.nextStep ?? '');

  const trial = trials.find((t) => t.id === trialId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trialId || !weekEnding) return;
    onSave({
      id: initial?.id, trialId, weekEnding,
      dueDate: dueDate || null, stage, health,
      owner: owner.trim() || null,
      whatHappened: whatHappened.trim() || null,
      nextStep: nextStep.trim() || null,
    });
  }

  return (
    <ModalShell title={initial ? 'Edit weekly update' : 'Add weekly update'}
      subtitle="The Weekly report pulls from this entry for its reporting week. Earlier weeks stay in Weekly history."
      onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Trial" required>
          <select value={trialId} onChange={(e) => setTrialId(e.target.value)}
            disabled={!!initial}
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm disabled:opacity-70">
            {trials.length === 0 && <option value="">No trials — create one first</option>}
            {trials.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {trial && <p className="text-[11px] text-gray-500 mt-1">{trial.animalGroup} / {trial.phase} — filled from the trial register</p>}
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Week ending" required>
            <input type="date" value={weekEnding} onChange={(e) => setWeekEnding(e.target.value)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
          </Field>
          <Field label="Due date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
          </Field>
          <Field label="Stage / status">
            <select value={stage} onChange={(e) => setStage(e.target.value as TrialStage)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
              {TRIAL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">To close out all reporting, use <span className="font-medium">Finish</span> on the tracker card.</p>
          </Field>
          <Field label="Health">
            <select value={health} onChange={(e) => setHealth(e.target.value as TrialHealth)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
              {TRIAL_HEALTHS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Owner">
          <input value={owner} onChange={(e) => setOwner(e.target.value)}
            placeholder="e.g. Andrew and Edwin"
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
        </Field>
        <Field label="What happened this week">
          <textarea value={whatHappened} onChange={(e) => setWhatHappened(e.target.value)}
            rows={4}
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm resize-y" />
        </Field>
        <Field label="Next step">
          <textarea value={nextStep} onChange={(e) => setNextStep(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm resize-y" />
        </Field>
        <ModalFooter onCancel={onClose} submitLabel="Save update" />
      </form>
    </ModalShell>
  );
}

// ── Modal primitives ──────────────────────────────────────────
function ModalShell({ title, subtitle, children, onClose }: {
  title: string; subtitle?: string; children: React.ReactNode; onClose: () => void;
}) {
  const first = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={first} className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
function ModalFooter({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div className="pt-2 flex items-center justify-end gap-2">
      <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800">Cancel</button>
      <button type="submit" className="text-sm px-4 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium">{submitLabel}</button>
    </div>
  );
}

// ── Print stylesheet (Weekly report tab only) ────────────────
function PrintStyles() {
  return (
    <style jsx global>{`
      @media print {
        body { background: white !important; }
        .print\\:hidden { display: none !important; }
        .print\\:p-0 { padding: 0 !important; }
        .print\\:border-0 { border: 0 !important; }
        .print\\:break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
        .print\\:grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)) !important; }
      }
    `}</style>
  );
}
