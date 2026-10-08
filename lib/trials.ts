/**
 * Trial Tracker — CRUD wrapper for `trials` + `trial_updates`
 * (data-migration/36-trials.sql).
 *
 * The marketing team was running this flow outside the CRM
 * (monogastric-trials.vercel.app) and asked for it to live here so
 * weekly reports can be assembled in one place. See
 *   app/trials/page.tsx           — 3-tab UI (tracker / history / report)
 *   app/api/ai/generate-weekly-report/route.ts — auto-fills Trial rows
 *
 * Kept in its own module (not db.ts) to avoid touching that hot
 * spot; mirrors lib/productCatalog.ts and lib/inventory.ts.
 */

import { createClient } from '@supabase/supabase-js';

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Types ─────────────────────────────────────────────────────

/** Top-level animal grouping — chosen to match both the external
 *  tracker and the Weekly Report sections (Monogastric/Ruminants/LATAM). */
export type AnimalGroup = 'Poultry' | 'Swine' | 'Poultry/Swine' | 'Ruminants' | 'LATAM';

/** Weekly update stage. Order matters — rendering code sorts by
 *  this enum to show in-progress trials ahead of on-hold ones. */
export type TrialStage =
  | 'Protocol / Pre-start'
  | 'Active Trial'
  | 'Analysis / Reporting'
  | 'On Hold'
  | 'Complete';

export const TRIAL_STAGES: TrialStage[] = [
  'Protocol / Pre-start', 'Active Trial', 'Analysis / Reporting', 'On Hold', 'Complete',
];

/** Green = healthy, Amber = watch, Red = at-risk. Mirrors the
 *  Health signal on the external tracker. */
export type TrialHealth = 'Green' | 'Amber' | 'Red';
export const TRIAL_HEALTHS: TrialHealth[] = ['Green', 'Amber', 'Red'];

/** Phase options per animal group. Free-form in the DB; this map
 *  drives the UI dropdown. The last entry is a catch-all "Other X"
 *  so admins never get stuck on an uncovered phase. */
export const PHASES_BY_GROUP: Record<AnimalGroup, string[]> = {
  Poultry:         ['Broiler', 'Layer', 'Turkey', 'Other Poultry'],
  Swine:           ['Nursery', 'Grower', 'Finisher', 'Wean-to-Finish', 'Gestation', 'Lactation', 'Other Swine'],
  'Poultry/Swine': ['Mixed Poultry/Swine'],
  Ruminants:       ['Dairy', 'Beef', 'Calf', 'Other Ruminants'],
  LATAM:           ['Monogastric (LATAM)', 'Ruminants (LATAM)', 'Other LATAM'],
};

export interface Trial {
  id: string;
  name: string;
  animalGroup: AnimalGroup;
  phase: string;
  finishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrialUpdate {
  id: string;
  trialId: string;
  /** YYYY-MM-DD — the Wednesday the reporting week ends on. */
  weekEnding: string;
  dueDate: string | null;
  stage: TrialStage;
  health: TrialHealth;
  owner: string | null;
  whatHappened: string | null;
  nextStep: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Row shapes ────────────────────────────────────────────────

type TrialRow = {
  id: string; name: string; animal_group: AnimalGroup; phase: string;
  finished_at: string | null; created_by: string | null;
  created_at: string; updated_at: string;
};
type UpdateRow = {
  id: string; trial_id: string; week_ending: string; due_date: string | null;
  stage: TrialStage; health: TrialHealth; owner: string | null;
  what_happened: string | null; next_step: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};

function asTrial(r: TrialRow): Trial {
  return {
    id: r.id, name: r.name, animalGroup: r.animal_group, phase: r.phase,
    finishedAt: r.finished_at, createdBy: r.created_by,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function asUpdate(r: UpdateRow): TrialUpdate {
  return {
    id: r.id, trialId: r.trial_id, weekEnding: r.week_ending, dueDate: r.due_date,
    stage: r.stage, health: r.health, owner: r.owner,
    whatHappened: r.what_happened, nextStep: r.next_step,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ── Trials ───────────────────────────────────────────────────

export async function listTrials(): Promise<Trial[]> {
  const { data, error } = await sb()
    .from('trials').select('*').order('name');
  if (error) throw error;
  return (data as TrialRow[]).map(asTrial);
}

export async function upsertTrial(
  input: Partial<Trial> & { name: string; animalGroup: AnimalGroup; phase: string },
): Promise<Trial> {
  const payload: Record<string, unknown> = {
    name: input.name.trim(),
    animal_group: input.animalGroup,
    phase: input.phase,
    finished_at: input.finishedAt ?? null,
    updated_at: new Date().toISOString(),
  };
  if (input.id) payload.id = input.id;
  if (input.createdBy && !input.id) payload.created_by = input.createdBy;
  const { data, error } = await sb()
    .from('trials').upsert(payload).select('*').single();
  if (error) throw error;
  return asTrial(data as TrialRow);
}

export async function finishTrial(id: string): Promise<void> {
  const { error } = await sb()
    .from('trials')
    .update({ finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function reopenTrial(id: string): Promise<void> {
  const { error } = await sb()
    .from('trials')
    .update({ finished_at: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteTrial(id: string): Promise<void> {
  // trial_updates has ON DELETE CASCADE so children drop with the parent.
  const { error } = await sb().from('trials').delete().eq('id', id);
  if (error) throw error;
}

// ── Updates ──────────────────────────────────────────────────

export async function listUpdates(): Promise<TrialUpdate[]> {
  const { data, error } = await sb()
    .from('trial_updates').select('*')
    .order('week_ending', { ascending: false });
  if (error) throw error;
  return (data as UpdateRow[]).map(asUpdate);
}

export async function upsertUpdate(
  input: Partial<TrialUpdate> & {
    trialId: string; weekEnding: string; stage: TrialStage; health: TrialHealth;
  },
): Promise<TrialUpdate> {
  const payload: Record<string, unknown> = {
    trial_id: input.trialId,
    week_ending: input.weekEnding,
    due_date: input.dueDate ?? null,
    stage: input.stage,
    health: input.health,
    owner: input.owner ?? null,
    what_happened: input.whatHappened ?? null,
    next_step: input.nextStep ?? null,
    updated_at: new Date().toISOString(),
  };
  if (input.id) payload.id = input.id;
  if (input.createdBy && !input.id) payload.created_by = input.createdBy;
  // Upsert on the (trial_id, week_ending) unique index so re-saving
  // the same reporting week replaces rather than duplicates.
  const { data, error } = await sb()
    .from('trial_updates')
    .upsert(payload, { onConflict: 'trial_id,week_ending' })
    .select('*').single();
  if (error) throw error;
  return asUpdate(data as UpdateRow);
}

export async function deleteUpdate(id: string): Promise<void> {
  const { error } = await sb().from('trial_updates').delete().eq('id', id);
  if (error) throw error;
}

/** Weekly Report use-case — all updates for one week-ending date,
 *  joined to their trial. Finished trials are excluded by default
 *  because the public report only shows ongoing work. */
export async function listUpdatesForWeek(
  weekEnding: string, opts: { includeFinished?: boolean } = {},
): Promise<{ trial: Trial; update: TrialUpdate }[]> {
  const [uRes, tRes] = await Promise.all([
    sb().from('trial_updates').select('*').eq('week_ending', weekEnding),
    sb().from('trials').select('*'),
  ]);
  if (uRes.error) throw uRes.error;
  if (tRes.error) throw tRes.error;
  const trialById = new Map((tRes.data as TrialRow[]).map((r) => [r.id, asTrial(r)]));
  const out: { trial: Trial; update: TrialUpdate }[] = [];
  for (const u of uRes.data as UpdateRow[]) {
    const trial = trialById.get(u.trial_id);
    if (!trial) continue;
    if (!opts.includeFinished && trial.finishedAt) continue;
    out.push({ trial, update: asUpdate(u) });
  }
  return out;
}

/** All updates for one trial, newest first. Used by Weekly History. */
export async function listUpdatesForTrial(trialId: string): Promise<TrialUpdate[]> {
  const { data, error } = await sb()
    .from('trial_updates').select('*')
    .eq('trial_id', trialId)
    .order('week_ending', { ascending: false });
  if (error) throw error;
  return (data as UpdateRow[]).map(asUpdate);
}

// ── Date helpers ──────────────────────────────────────────────

/** The external tracker treats the week-ending date as a
 *  Wednesday. Given any date, return the Wednesday of its week in
 *  YYYY-MM-DD (local time, no TZ shifting). */
export function wednesdayOf(d: Date = new Date()): string {
  const day = d.getDay(); // 0=Sun..6=Sat
  // Wednesday = 3. Shift forward to the nearest Wed; if we're past
  // Wed, snap backwards. (So Monday → Wed in 2 days; Thursday → Wed
  // of same week, i.e. 1 day back.)
  const offset = 3 - day;
  const w = new Date(d);
  w.setDate(w.getDate() + offset);
  // Pad to YYYY-MM-DD. Using local components matches the <input
  // type="date"> value the UI sends.
  const y = w.getFullYear();
  const m = String(w.getMonth() + 1).padStart(2, '0');
  const dd = String(w.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** List of recent week-ending Wednesdays (newest first) for the
 *  Weekly Report picker. */
export function recentWeekEndings(count = 12): string[] {
  const out: string[] = [];
  const base = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - 7 * i);
    out.push(wednesdayOf(d));
  }
  // De-dupe (first iteration might snap to the same Wednesday as the
  // "current" one) and sort newest first.
  return Array.from(new Set(out)).sort((a, b) => b.localeCompare(a));
}

/** Format a YYYY-MM-DD as "Oct 7, 2026" for display. */
export function formatWeekEnding(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
