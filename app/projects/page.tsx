'use client';

/**
 * /projects — Marketing project tracker (Gantt-style 12-month view).
 *
 * Layout:
 *   - Top bar with year selector, team filter chips, "Add project" button.
 *   - Team color legend.
 *   - 12-month horizontal Gantt:
 *       · Each project = a draggable horizontal bar positioned by
 *         start_date/end_date within the selected year (proportional to
 *         day-of-year).
 *       · Red vertical line marks "today" when viewing the current year.
 *       · Horizontal drag = shift project dates (start+end move by the
 *         same number of days). Snap to whole days.
 *       · Click (no drag) on a bar = open edit modal.
 *       · Vertical drag (reorder rows) — TODO; sort_order column is in
 *         place but the UI is not wired up yet (deferred — most users
 *         will reorder via stage/team filtering instead).
 *   - "Completed projects" tray at the bottom. Stage === 'completed'
 *     bubbles automatically into this section; stage transition is the
 *     single source of truth (see lib/db.dbUpdateProject — it manages
 *     completed_at).
 *
 * Permissions: every authenticated user with /projects menu access can
 * read, add, edit, and delete. See useMenuAccess ROLE_DEFAULTS.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectTeam, ProjectStage } from '@/lib/data';
import { PROJECT_TEAMS, PROJECT_STAGES } from '@/lib/data';
import { dbGetProjects, dbUpdateProject } from '@/lib/db';
import TopBar from '@/app/components/TopBar';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import ProjectModal from '@/app/components/ProjectModal';

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Lookup tables — derived from PROJECT_TEAMS / PROJECT_STAGES constants
// so adding a team in lib/data.ts automatically flows through.
const TEAM_BY_ID = Object.fromEntries(PROJECT_TEAMS.map((t) => [t.id, t])) as Record<ProjectTeam, typeof PROJECT_TEAMS[number]>;
const STAGE_LABEL = Object.fromEntries(PROJECT_STAGES.map((s) => [s.id, s.label])) as Record<ProjectStage, string>;

/** Days from Jan 1 of year. 0-indexed (Jan 1 = 0). Leap-year-aware. */
function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  // Math.round handles DST transitions cleanly.
  return Math.round((date.getTime() - start.getTime()) / 86_400_000);
}

/** Total days in a year (365 or 366). */
function daysInYear(year: number): number {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
}

/** Parse 'YYYY-MM-DD' into a local-date (avoids the UTC shift you get
 *  with `new Date(string)` for date-only ISO strings). */
function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map((p) => parseInt(p, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Format Date → 'YYYY-MM-DD' (local, no TZ shift). */
function fmtISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Display format for completion date in the bottom tray. */
function fmtShortDate(iso: string): string {
  const d = parseISODate(iso.length > 10 ? iso.slice(0, 10) : iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ProjectsPage() {
  const now = new Date();
  const currentYear = now.getFullYear();

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedTeam, setSelectedTeam] = useState<ProjectTeam | null>(null);
  // Ref to the "Completed projects" panel + a flag that lights up while a
  // bar is being dragged over it. The drop-target rect is read from the
  // ref inside GanttBar's pointer-up handler — no library, no global
  // state manager, just clientY vs. boundingClientRect.
  const completedZoneRef = useRef<HTMLDivElement | null>(null);
  const [dragOverCompleted, setDragOverCompleted] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<
    | { mode: 'add'; defaultStartDate: string; defaultEndDate: string; defaultTeam?: ProjectTeam }
    | { mode: 'edit'; project: Project }
    | null
  >(null);

  // Year dropdown: current ± a few. Same pattern as /rnd.
  const yearOptions = useMemo(() => {
    const ys = new Set<number>();
    ys.add(currentYear - 1); ys.add(currentYear); ys.add(currentYear + 1); ys.add(currentYear + 2);
    projects.forEach((p) => {
      ys.add(parseISODate(p.startDate).getFullYear());
      ys.add(parseISODate(p.endDate).getFullYear());
    });
    return [...ys].sort((a, b) => b - a);
  }, [currentYear, projects]);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const rows = await dbGetProjects();
      setProjects(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to load projects: ${msg}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  // ── Filter + bucket projects ────────────────────────────────────────
  // `inYear` are the bars that show up on the Gantt. `completed` flows
  // into the bottom tray regardless of where its dates sit.
  const { inYear, completed } = useMemo(() => {
    const filtered = projects.filter((p) => selectedTeam ? p.team === selectedTeam : true);
    const yearStart = new Date(selectedYear, 0, 1);
    const yearEnd = new Date(selectedYear, 11, 31);
    const inYear: Project[] = [];
    const completedBucket: Project[] = [];
    for (const p of filtered) {
      if (p.stage === 'completed') {
        completedBucket.push(p);
        continue;
      }
      const s = parseISODate(p.startDate);
      const e = parseISODate(p.endDate);
      // Skip projects entirely outside the selected year window.
      if (e < yearStart || s > yearEnd) continue;
      inYear.push(p);
    }
    // Sort Gantt rows by start date so newest plans don't jump around.
    inYear.sort((a, b) => a.startDate.localeCompare(b.startDate));
    completedBucket.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    return { inYear, completed: completedBucket };
  }, [projects, selectedTeam, selectedYear]);

  // ── Today marker ────────────────────────────────────────────────────
  const todayMarkerPct = useMemo(() => {
    if (now.getFullYear() !== selectedYear) return null;
    return (dayOfYear(now) / daysInYear(selectedYear)) * 100;
  }, [now, selectedYear]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar placeholder="Search projects..." />

      {/* pt-16 reserves space for the fixed TopBar (h ≈ 64px). Same
          pattern as /rnd — without this the page title slides under it. */}
      <main className="pt-16 px-4 md:px-8 py-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-7 h-7 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Project Tracker
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              Marketing projects on a 12-month timeline. Drag a bar to shift its dates, or click to edit.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              onClick={() => {
                // Default new project to today → today+30 days.
                const start = new Date();
                const end = new Date();
                end.setDate(end.getDate() + 30);
                setModal({
                  mode: 'add',
                  defaultStartDate: fmtISODate(start),
                  defaultEndDate: fmtISODate(end),
                  defaultTeam: selectedTeam ?? undefined,
                });
              }}
              className="inline-flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg px-3 py-2 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add project
            </button>
          </div>
        </div>

        {/* Team filter chips + legend (doubles as both) */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={() => setSelectedTeam(null)}
            className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
              selectedTeam === null
                ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-slate-800 dark:text-gray-300 dark:border-slate-600 dark:hover:bg-slate-700'
            }`}
          >
            All teams
          </button>
          {PROJECT_TEAMS.map((t) => {
            const active = selectedTeam === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedTeam(active ? null : t.id)}
                className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1.5 ${
                  active
                    ? 'border-transparent text-white shadow-sm'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-slate-800 dark:text-gray-300 dark:border-slate-600 dark:hover:bg-slate-700'
                }`}
                style={active ? { backgroundColor: t.color, color: t.textColor } : undefined}
              >
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: t.color }} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Errors */}
        {error && (
          <div role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20"><LoadingSpinner /></div>
        ) : (
          <>
            {/* Gantt panel */}
            <GanttPanel
              year={selectedYear}
              projects={inYear}
              todayMarkerPct={todayMarkerPct}
              completedZoneRef={completedZoneRef}
              onDragOverCompletedChange={setDragOverCompleted}
              onEdit={(p) => setModal({ mode: 'edit', project: p })}
              onDateShift={async (id, newStart, newEnd, newSubBars) => {
                // Optimistic update + persist. On error, reload to reconcile.
                setProjects((prev) => prev.map((p) => p.id === id
                  ? { ...p, startDate: newStart, endDate: newEnd, ...(newSubBars ? { subBars: newSubBars } : {}) }
                  : p));
                try {
                  await dbUpdateProject(id, {
                    startDate: newStart,
                    endDate: newEnd,
                    ...(newSubBars ? { subBars: newSubBars } : {}),
                  });
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  console.error('Date shift failed:', msg);
                  setError(`Date shift failed: ${msg}`);
                  reload();
                }
              }}
              onMarkCompleted={async (id) => {
                // Drop-to-complete: same optimistic + persist pattern as
                // date shift. Bar instantly disappears from the Gantt
                // (filtered out by stage === 'completed') and the
                // completed tray re-sorts to put this row on top.
                setProjects((prev) => prev.map((p) => p.id === id ? {
                  ...p,
                  stage: 'completed' as const,
                  completedAt: new Date().toISOString(),
                } : p));
                try {
                  await dbUpdateProject(id, { stage: 'completed' });
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  console.error('Mark completed failed:', msg);
                  setError(`Mark completed failed: ${msg}`);
                  reload();
                }
              }}
            />

            {/* Completed tray — also the drop target. completedZoneRef
                is read by GanttBar's pointer-up handler to decide
                whether the drag should mark-complete vs. date-shift. */}
            <div
              ref={completedZoneRef}
              className={`mt-8 rounded-lg transition-all ${
                dragOverCompleted
                  ? 'ring-2 ring-green-400 dark:ring-green-500 bg-green-50/60 dark:bg-green-950/20 p-2 -m-2'
                  : ''
              }`}
            >
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                </svg>
                Completed projects
                <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">({completed.length})</span>
                {dragOverCompleted && (
                  <span className="ml-2 text-xs text-green-700 dark:text-green-400 font-medium">Drop here to complete</span>
                )}
              </h2>
              {completed.length === 0 ? (
                <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-800/60 rounded-lg px-3 py-3 border border-dashed border-gray-300 dark:border-slate-700">
                  Drag a project bar here to mark it completed, or click a bar and choose &quot;Mark as completed&quot;.
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800">
                  {completed.map((p) => {
                    const team = TEAM_BY_ID[p.team];
                    return (
                      <button
                        key={p.id}
                        onClick={() => setModal({ mode: 'edit', project: p })}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 text-left transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: team?.color ?? '#888' }} />
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.name}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{team?.label ?? p.team}</span>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                          {p.completedAt ? `Completed ${fmtShortDate(p.completedAt)}` : 'Completed'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {modal && (
        <ProjectModal
          editing={modal.mode === 'edit' ? modal.project : null}
          defaultStartDate={modal.mode === 'add' ? modal.defaultStartDate : ''}
          defaultEndDate={modal.mode === 'add' ? modal.defaultEndDate : ''}
          defaultTeam={modal.mode === 'add' ? modal.defaultTeam : undefined}
          onClose={() => setModal(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Gantt panel — month header + project bars positioned by day-of-year.
// Split out so the page component stays focused on data plumbing.
// ──────────────────────────────────────────────────────────────────────

interface GanttPanelProps {
  year: number;
  projects: Project[];
  todayMarkerPct: number | null;
  /** Ref to the "Completed projects" panel. Read inside GanttBar's
   *  pointer-up handler to decide if the drag ended inside the
   *  drop zone (→ mark completed) vs. inside the timeline (→ date shift). */
  completedZoneRef: React.RefObject<HTMLDivElement | null>;
  onDragOverCompletedChange: (over: boolean) => void;
  onEdit: (p: Project) => void;
  // Sub-bars travel with the parent on drag — the 4th arg carries the
  // already-shifted phases so the page handler just persists them.
  onDateShift: (id: string, newStart: string, newEnd: string, newSubBars?: Project['subBars']) => void;
  onMarkCompleted: (id: string) => void;
}

function GanttPanel({ year, projects, todayMarkerPct, completedZoneRef, onDragOverCompletedChange, onEdit, onDateShift, onMarkCompleted }: GanttPanelProps) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
      {/* Month header */}
      <div className="grid grid-cols-12 bg-gray-50 dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-700">
        {MONTH_LABELS.map((m, i) => (
          <div
            key={m}
            className={`text-[11px] font-medium text-gray-600 dark:text-gray-300 text-center py-2 ${i < 11 ? 'border-r border-gray-200 dark:border-slate-700' : ''}`}
          >
            {m}
          </div>
        ))}
      </div>

      {/* Rows container */}
      <div className="relative py-3">
        {/* Month grid background lines */}
        <div className="absolute inset-0 grid grid-cols-12 pointer-events-none">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={i < 11 ? 'border-r border-gray-100 dark:border-slate-800' : ''} />
          ))}
        </div>

        {/* Today vertical line */}
        {todayMarkerPct !== null && (
          <>
            <div
              className="absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none"
              style={{ left: `${todayMarkerPct}%` }}
              aria-hidden="true"
            />
            <div
              className="absolute -top-5 text-[10px] font-medium text-red-500 z-10 pointer-events-none"
              style={{ left: `calc(${todayMarkerPct}% - 16px)` }}
            >
              Today
            </div>
          </>
        )}

        {/* Empty state */}
        {projects.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400 relative z-[1]">
            No active projects for {year}. Click <span className="font-medium text-gray-700 dark:text-gray-200">Add project</span> to start.
          </div>
        ) : (
          <div className="relative">
            {projects.map((p) => (
              <GanttBar
                key={p.id}
                project={p}
                year={year}
                completedZoneRef={completedZoneRef}
                onDragOverCompletedChange={onDragOverCompletedChange}
                onEdit={onEdit}
                onDateShift={onDateShift}
                onMarkCompleted={onMarkCompleted}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Single bar — handles position math + horizontal drag-to-shift.
// ──────────────────────────────────────────────────────────────────────

interface GanttBarProps {
  project: Project;
  year: number;
  completedZoneRef: React.RefObject<HTMLDivElement | null>;
  onDragOverCompletedChange: (over: boolean) => void;
  onEdit: (p: Project) => void;
  onDateShift: (id: string, newStart: string, newEnd: string, newSubBars?: Project['subBars']) => void;
  onMarkCompleted: (id: string) => void;
}

function GanttBar({ project, year, completedZoneRef, onDragOverCompletedChange, onEdit, onDateShift, onMarkCompleted }: GanttBarProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [dragDeltaPct, setDragDeltaPct] = useState(0);
  // Track full drag state including last pointer Y — needed so onPointerUp
  // can ask "are we over the Completed zone?" without recomputing.
  const draggingRef = useRef<{ startX: number; startY: number; rowWidth: number; moved: boolean; overCompleted: boolean } | null>(null);

  const yearDays = daysInYear(year);
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  const start = parseISODate(project.startDate);
  const end = parseISODate(project.endDate);

  // Clamp into year window so a project running Dec 2025 → Feb 2026 still
  // shows a partial bar on the 2026 view.
  const visibleStart = start < yearStart ? yearStart : start;
  const visibleEnd = end > yearEnd ? yearEnd : end;

  const startDay = dayOfYear(visibleStart);
  // +1 so a same-day project is one slot wide, not zero.
  const endDay = dayOfYear(visibleEnd) + 1;
  const baseLeftPct = (startDay / yearDays) * 100;
  const baseWidthPct = Math.max(0.5, ((endDay - startDay) / yearDays) * 100);

  // Apply drag-in-progress offset so the bar follows the pointer.
  const leftPct = baseLeftPct + dragDeltaPct;

  const team = TEAM_BY_ID[project.team];
  const stageLabel = STAGE_LABEL[project.stage];

  /** Is the pointer currently inside the Completed-projects panel? */
  function isOverCompletedZone(clientX: number, clientY: number): boolean {
    const el = completedZoneRef.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    draggingRef.current = { startX: e.clientX, startY: e.clientY, rowWidth: rect.width, moved: false, overCompleted: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = draggingRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    setDragDeltaPct((dx / drag.rowWidth) * 100);

    // Light up the Completed zone whenever the pointer enters it.
    const over = isOverCompletedZone(e.clientX, e.clientY);
    if (over !== drag.overCompleted) {
      drag.overCompleted = over;
      onDragOverCompletedChange(over);
    }
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = draggingRef.current;
    draggingRef.current = null;
    if (!drag) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    onDragOverCompletedChange(false);

    if (!drag.moved) {
      // Treat as click → open edit modal.
      setDragDeltaPct(0);
      onEdit(project);
      return;
    }

    // Dropped on the Completed tray → mark completed (takes precedence
    // over any horizontal delta — we ignore date shift in that case).
    if (isOverCompletedZone(e.clientX, e.clientY)) {
      setDragDeltaPct(0);
      onMarkCompleted(project.id);
      return;
    }

    // Otherwise: convert pixel delta → days (rounded), shift both endpoints.
    const deltaPx = e.clientX - drag.startX;
    const deltaDays = Math.round((deltaPx / drag.rowWidth) * yearDays);
    setDragDeltaPct(0);
    if (deltaDays === 0) return;
    const newStart = new Date(start);
    newStart.setDate(newStart.getDate() + deltaDays);
    const newEnd = new Date(end);
    newEnd.setDate(newEnd.getDate() + deltaDays);
    // Shift every sub-bar by the same number of days so phases travel
    // with the parent. Without this the parent's drag would silently
    // leave the phases stranded at their original dates.
    const shiftedSubBars = (project.subBars ?? []).map((sb) => {
      const ss = new Date(sb.startDate + 'T00:00:00');
      const se = new Date(sb.endDate + 'T00:00:00');
      ss.setDate(ss.getDate() + deltaDays);
      se.setDate(se.getDate() + deltaDays);
      return { ...sb, startDate: fmtISODate(ss), endDate: fmtISODate(se) };
    });
    onDateShift(project.id, fmtISODate(newStart), fmtISODate(newEnd), shiftedSubBars);
  }
  function onPointerCancel() {
    draggingRef.current = null;
    setDragDeltaPct(0);
    onDragOverCompletedChange(false);
  }

  // Sub-bars (timeline phases) — each renders as a slim bar below the
  // parent bar with its own label. 12px tall so 9px text reads inside.
  // Row height grows by 14px per sub-bar (12 bar + 2 gap) so they don't
  // collide with the next project row.
  const subBars = project.subBars ?? [];
  const SUB_BAR_HEIGHT = 12;
  const SUB_BAR_GAP = 2;
  const subBarRowHeight = 40 + (subBars.length > 0
    ? 4 + subBars.length * (SUB_BAR_HEIGHT + SUB_BAR_GAP)
    : 0);

  return (
    <div ref={rowRef} className="relative my-1 px-2" style={{ height: `${subBarRowHeight}px` }}>
      <div
        role="button"
        tabIndex={0}
        title={`${project.name} · ${team?.label ?? project.team} · ${stageLabel}\n${project.startDate} → ${project.endDate}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onEdit(project);
          }
        }}
        className="absolute top-1 h-8 rounded-md shadow-sm flex items-center justify-between gap-2 px-2 cursor-grab active:cursor-grabbing select-none overflow-hidden"
        style={{
          left: `${leftPct}%`,
          width: `${baseWidthPct}%`,
          backgroundColor: team?.color ?? '#999',
          color: team?.textColor ?? '#111',
          minWidth: 56,
        }}
      >
        {/* Phase progress overlay — darker shade fills the bar from the
            left, proportional to completed sub-bars (phases). Switched
            from tasks → subBars because phases are the more meaningful
            unit of completion at the project level (each phase = a real
            chunk of work, while checklist items are sub-step details). */}
        {(() => {
          const total = project.subBars?.length ?? 0;
          if (total === 0) return null;
          const done = project.subBars!.filter((s) => s.done).length;
          const pct = Math.round((done / total) * 100);
          return (
            <div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 pointer-events-none"
              style={{ width: `${pct}%`, backgroundColor: 'rgba(0,0,0,0.18)' }}
            />
          );
        })()}
        <span className="text-[11px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis relative z-10">
          {project.name}
        </span>
        <span
          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 relative z-10"
          style={{ backgroundColor: 'rgba(255,255,255,0.35)', color: team?.textColor ?? '#111' }}
        >
          {project.subBars && project.subBars.length > 0
            ? `${project.subBars.filter((s) => s.done).length}/${project.subBars.length}`
            : stageLabel}
        </span>
      </div>

      {subBars.map((sb, sbIdx) => {
        const sbStart = new Date(sb.startDate + 'T00:00:00');
        const sbEnd = new Date(sb.endDate + 'T00:00:00');
        if (isNaN(sbStart.getTime()) || isNaN(sbEnd.getTime())) return null;
        const sbVisStart = sbStart < yearStart ? yearStart : sbStart;
        const sbVisEnd = sbEnd > yearEnd ? yearEnd : sbEnd;
        const sbStartDay = dayOfYear(sbVisStart);
        const sbEndDay = dayOfYear(sbVisEnd) + 1;
        if (sbEndDay <= sbStartDay) return null;
        // Apply the same in-progress drag offset as the parent so phases
        // travel with the parent bar visually while the pointer is down.
        const sbLeft = (sbStartDay / yearDays) * 100 + dragDeltaPct;
        const sbWidth = Math.max(0.3, ((sbEndDay - sbStartDay) / yearDays) * 100);
        const labelText = sb.label || '(unnamed phase)';
        return (
          <div
            key={sb.id}
            title={`${labelText} · ${sb.startDate} → ${sb.endDate}${sb.done ? ' · done' : ''}`}
            className="absolute rounded-sm pointer-events-none flex items-center overflow-hidden"
            style={{
              left: `${sbLeft}%`,
              width: `${sbWidth}%`,
              top: `${40 + 4 + sbIdx * (SUB_BAR_HEIGHT + SUB_BAR_GAP)}px`,
              height: `${SUB_BAR_HEIGHT}px`,
              backgroundColor: team?.color ?? '#999',
              opacity: sb.done ? 0.45 : 0.9,
              minWidth: 4,
              paddingLeft: 4,
              paddingRight: 4,
            }}
          >
            <span
              className="text-[9px] font-semibold whitespace-nowrap leading-none"
              style={{
                color: team?.textColor ?? '#111',
                textDecoration: sb.done ? 'line-through' : 'none',
                textDecorationThickness: sb.done ? '1px' : undefined,
              }}
            >
              {labelText}
            </span>
          </div>
        );
      })}
    </div>
  );
}
