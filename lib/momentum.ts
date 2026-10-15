/**
 * Weekly Momentum Score — scoring logic + helpers.
 *
 * One score per (user, ISO week). The cron (/api/cron/weekly-momentum)
 * reads activities/tasks/opportunities/trial_updates for the week,
 * passes them to computeWeeklyScore, and upserts the result into
 * user_weekly_momentum (data-migration/40).
 *
 * Pure functions here — no DB imports — so the UI can also recompute
 * on the fly if needed (e.g. "live" preview after logging an activity).
 */

// ── Weights ────────────────────────────────────────────────────
// Tuned so the mix of activities that marketing/directors want to
// reward (face-to-face meetings and progressed deals) dominates the
// score, but still rewards consistent logging. ★ (important) activities
// get a bump because reps only star what matters to the Weekly Report.
export const MOMENTUM_WEIGHTS = {
  activity: {
    Meeting: 10,
    Call: 5,
    Email: 3,
    Note: 1,
  } as Record<string, number>,
  /** Bonus added on top when activity.isImportant === true */
  starBonus: 3,
  /** One completed task = this many points. Follow-ups spawned from
   *  activities count the same — closing the loop is what matters. */
  taskCompleted: 2,
  /** One trial_update row entered this week (any health, any stage). */
  trialUpdate: 8,
  /** Opp that flipped to 'Won' with closeDate in the week. One-shot
   *  bonus so a single win doesn't dominate an entire quarter, but
   *  big enough that closing a deal is visibly rewarded. */
  oppWon: 50,
} as const;

// ── Types ──────────────────────────────────────────────────────
export interface MomentumBreakdown {
  activities: { Call: number; Meeting: number; Email: number; Note: number; starred: number };
  tasksCompleted: number;
  trialUpdates: number;
  oppsWon: number;
}

export interface MomentumInputRow {
  type: 'activity' | 'task' | 'trial_update' | 'opp_won';
  // Activity-specific
  activityType?: 'Call' | 'Meeting' | 'Email' | 'Note' | string;
  isImportant?: boolean;
}

export interface WeekRange {
  startISO: string;  // YYYY-MM-DD (Monday)
  endISO: string;    // YYYY-MM-DD (Sunday)
}

// ── Date helpers ───────────────────────────────────────────────

/** Snap any Date to that week's Monday as YYYY-MM-DD (local time).
 *  ISO weeks start Monday; US sales habits align with Mon-Fri so
 *  Monday is the natural reset. */
export function mondayOf(d: Date = new Date()): string {
  const w = new Date(d);
  const day = w.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // back up to Monday
  w.setDate(w.getDate() + diff);
  const y = w.getFullYear();
  const m = String(w.getMonth() + 1).padStart(2, '0');
  const dd = String(w.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** From a Monday ISO string, return the Monday→Sunday range. */
export function weekRangeFromMonday(mondayISO: string): WeekRange {
  const [y, m, d] = mondayISO.split('-').map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  return { startISO: fmt(start), endISO: fmt(end) };
}

/** Previous week's Monday — handy for the cron's two-week rebuild. */
export function previousMonday(mondayISO: string): string {
  const [y, m, d] = mondayISO.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() - 7);
  const fy = dt.getFullYear();
  const fm = String(dt.getMonth() + 1).padStart(2, '0');
  const fd = String(dt.getDate()).padStart(2, '0');
  return `${fy}-${fm}-${fd}`;
}

/** Returns true when `dateISO` (YYYY-MM-DD) falls in the inclusive
 *  Monday→Sunday window of `mondayISO`. */
export function isDateInWeek(dateISO: string, mondayISO: string): boolean {
  if (!dateISO) return false;
  const d = dateISO.slice(0, 10);
  const { startISO, endISO } = weekRangeFromMonday(mondayISO);
  return d >= startISO && d <= endISO;
}

// ── Core scoring ───────────────────────────────────────────────

/** Pure function: given a flat list of per-row inputs for one week,
 *  return { score, breakdown }.
 *
 *  Caller is responsible for filtering rows down to the target user
 *  and the target week BEFORE handing them to this function — this
 *  keeps the scoring itself trivial and side-effect-free. */
export function computeWeeklyScore(
  rows: MomentumInputRow[],
): { score: number; breakdown: MomentumBreakdown } {
  const breakdown: MomentumBreakdown = {
    activities: { Call: 0, Meeting: 0, Email: 0, Note: 0, starred: 0 },
    tasksCompleted: 0,
    trialUpdates: 0,
    oppsWon: 0,
  };
  let score = 0;

  for (const r of rows) {
    if (r.type === 'activity') {
      const t = r.activityType || 'Note';
      const base = MOMENTUM_WEIGHTS.activity[t] ?? 1;
      score += base;
      if (r.isImportant) {
        score += MOMENTUM_WEIGHTS.starBonus;
        breakdown.activities.starred += 1;
      }
      if (t === 'Call' || t === 'Meeting' || t === 'Email' || t === 'Note') {
        breakdown.activities[t] += 1;
      } else {
        breakdown.activities.Note += 1;
      }
    } else if (r.type === 'task') {
      score += MOMENTUM_WEIGHTS.taskCompleted;
      breakdown.tasksCompleted += 1;
    } else if (r.type === 'trial_update') {
      score += MOMENTUM_WEIGHTS.trialUpdate;
      breakdown.trialUpdates += 1;
    } else if (r.type === 'opp_won') {
      score += MOMENTUM_WEIGHTS.oppWon;
      breakdown.oppsWon += 1;
    }
  }

  return { score, breakdown };
}

/** Percent delta vs. previous week. Returns null when prior = 0 to
 *  avoid "infinity" readings on a user's first active week. */
export function pctDelta(current: number, prior: number): number | null {
  if (!isFinite(prior) || prior <= 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

/** Short human label: "+23%" / "-12%" / "flat" / "—". */
export function formatDelta(pct: number | null): string {
  if (pct === null) return '—';
  if (Math.abs(pct) < 2) return 'flat';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}
