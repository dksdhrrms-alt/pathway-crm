/**
 * Trial Materials — per-trial file attachments with team-based
 * access control. Backed by data-migration/43-trial-materials.sql
 * (trial_files table + trial-files Storage bucket) and the new
 * users.trial_access_teams column.
 *
 * Access model, in one sentence:
 *   Admin / CEO / COO / administrative_manager always see every
 *   trial's files; a Sales Director sees everything in the bucket
 *   their users.team maps to; every other user sees a trial's files
 *   only if its animal_group's bucket is listed in the user's
 *   users.trial_access_teams array.
 *
 * Versioning is implicit, keyed on (trial_id, label): re-uploading
 * the same label creates a child row (parent_file_id = previous
 * head, version = prev + 1). listFilesForTrial() returns only the
 * head of each chain by default and exposes the chain on demand.
 */

import { createClient } from '@supabase/supabase-js';
import type { AppUser, TrialAccessTeam } from './users';
import type { AnimalGroup, Trial } from './trials';

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── animal_group → access bucket ──────────────────────────────

/** The DB stores six animal_group values and access is granted
 *  against four buckets. This map is the single source of truth. */
export function animalGroupToAccessTeam(g: AnimalGroup): TrialAccessTeam {
  if (g === 'Ruminants') return 'ruminants';
  if (g === 'LATAM')     return 'latam';
  if (g === 'Common')    return 'common';
  // Poultry, Swine, Poultry/Swine
  return 'monogastrics';
}

/** Inverse — used when filtering the trial list down to a given
 *  access bucket (e.g. for the Trial Report range checkboxes). */
export function accessTeamToAnimalGroups(t: TrialAccessTeam): AnimalGroup[] {
  if (t === 'ruminants')   return ['Ruminants'];
  if (t === 'latam')       return ['LATAM'];
  if (t === 'common')      return ['Common'];
  return ['Poultry', 'Swine', 'Poultry/Swine'];
}

// ── Permission check ─────────────────────────────────────────

const ADMIN_TIER = new Set(['admin', 'ceo', 'coo', 'administrative_manager']);

/** Which access buckets does Director `user` cover by role alone?
 *  'swine' and 'monogastrics' sales teams both map to the
 *  monogastrics bucket, matching how the Weekly Report groups them. */
function directorBucketsFor(user: AppUser): TrialAccessTeam[] {
  if (user.role !== 'sales_director') return [];
  if (user.team === 'monogastrics' || user.team === 'swine') return ['monogastrics'];
  if (user.team === 'ruminants') return ['ruminants'];
  if (user.team === 'latam')     return ['latam'];
  return [];
}

/** `true` if this user may read/write files on the given trial.
 *  Buckets are one-to-one with animal_group buckets — a user
 *  with the 'common' grant sees Common R&D trials, not every
 *  trial. Admin/CEO/COO/Admin Manager bypass the whole check. */
export function canAccessTrialFiles(user: AppUser | null | undefined, trial: Pick<Trial, 'animalGroup'>): boolean {
  if (!user) return false;
  if (ADMIN_TIER.has(user.role)) return true;
  const grants = user.trialAccessTeams ?? [];
  const bucket = animalGroupToAccessTeam(trial.animalGroup);
  if (directorBucketsFor(user).includes(bucket)) return true;
  return grants.includes(bucket);
}

/** All access buckets a user can see, for pre-filtering lists. */
export function accessibleBucketsFor(user: AppUser | null | undefined): TrialAccessTeam[] {
  if (!user) return [];
  if (ADMIN_TIER.has(user.role)) return ['monogastrics', 'ruminants', 'latam', 'common'];
  const dir = directorBucketsFor(user);
  const explicit = user.trialAccessTeams ?? [];
  return Array.from(new Set([...dir, ...explicit])) as TrialAccessTeam[];
}

// ── Types + row shapes ───────────────────────────────────────

export interface TrialFile {
  id: string;
  trialId: string;
  /** null for the first version in a chain. */
  parentFileId: string | null;
  version: number;
  label: string;
  url: string;
  storagePath: string | null;
  fileSize: number | null;
  mimeType: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

type FileRow = {
  id: string; trial_id: string; parent_file_id: string | null; version: number;
  label: string; url: string; storage_path: string | null;
  file_size: number | null; mime_type: string | null;
  uploaded_by: string | null; uploaded_at: string;
};

function asFile(r: FileRow): TrialFile {
  return {
    id: r.id, trialId: r.trial_id, parentFileId: r.parent_file_id, version: r.version,
    label: r.label, url: r.url, storagePath: r.storage_path,
    fileSize: r.file_size, mimeType: r.mime_type,
    uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at,
  };
}

// ── CRUD ─────────────────────────────────────────────────────

/** All files for one trial, newest first. When `includeHistory` is
 *  false (default) only the head of each version chain is returned. */
export async function listFilesForTrial(
  trialId: string, opts: { includeHistory?: boolean } = {},
): Promise<TrialFile[]> {
  const { data, error } = await sb()
    .from('trial_files').select('*')
    .eq('trial_id', trialId)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  const rows = (data as FileRow[]).map(asFile);
  if (opts.includeHistory) return rows;
  // Head = row whose id is not referenced by any sibling's parent_file_id.
  const referenced = new Set(rows.map((r) => r.parentFileId).filter(Boolean) as string[]);
  return rows.filter((r) => !referenced.has(r.id));
}

/** Fetch the full version chain (oldest → newest) for one file. */
export async function listVersionChain(fileId: string): Promise<TrialFile[]> {
  // Walk back from head, then flip.
  const { data: headData, error: headErr } = await sb()
    .from('trial_files').select('*').eq('id', fileId).single();
  if (headErr) throw headErr;
  const chain: FileRow[] = [headData as FileRow];
  let cursor: string | null = (headData as FileRow).parent_file_id;
  while (cursor) {
    const { data: p, error: pErr } = await sb()
      .from('trial_files').select('*').eq('id', cursor).maybeSingle();
    if (pErr) throw pErr;
    if (!p) break;
    chain.push(p as FileRow);
    cursor = (p as FileRow).parent_file_id;
  }
  return chain.reverse().map(asFile);
}

/** Upload a new file (or new version of an existing one) and insert
 *  the metadata row. If a file with the same `label` already exists
 *  on this trial, the new row is linked as a child with version+1.
 *
 *  Expects a File / Blob (browser) or a Buffer-ish (server). The
 *  caller is expected to pre-check canAccessTrialFiles(). */
export async function uploadTrialFile(input: {
  trialId: string;
  label: string;
  file: File | Blob;
  filename: string;
  mimeType?: string;
  uploadedBy?: string | null;
}): Promise<TrialFile> {
  const client = sb();
  // Find existing head for the same label — becomes our parent.
  const { data: existing, error: exErr } = await client
    .from('trial_files').select('*')
    .eq('trial_id', input.trialId)
    .eq('label', input.label);
  if (exErr) throw exErr;
  const siblings = (existing ?? []) as FileRow[];
  const referenced = new Set(siblings.map((r) => r.parent_file_id).filter(Boolean) as string[]);
  const head = siblings.find((r) => !referenced.has(r.id)) ?? null;

  // Build storage path with a timestamp so collisions never clobber.
  const safeName = input.filename.replace(/[^\w.\-]/g, '_');
  const path = `${input.trialId}/${Date.now()}_${safeName}`;

  const { error: upErr } = await client.storage
    .from('trial-files')
    .upload(path, input.file, {
      contentType: input.mimeType,
      cacheControl: '3600',
      upsert: false,
    });
  if (upErr) throw upErr;

  const { data: pub } = client.storage.from('trial-files').getPublicUrl(path);

  const payload: Record<string, unknown> = {
    trial_id: input.trialId,
    parent_file_id: head?.id ?? null,
    version: head ? head.version + 1 : 1,
    label: input.label,
    url: pub.publicUrl,
    storage_path: path,
    file_size: 'size' in input.file ? (input.file as File).size : null,
    mime_type: input.mimeType ?? null,
    uploaded_by: input.uploadedBy ?? null,
  };
  const { data, error } = await client
    .from('trial_files').insert(payload).select('*').single();
  if (error) throw error;
  return asFile(data as FileRow);
}

/** Delete one file row + its storage object. Cascades to child
 *  versions via the FK. The caller is expected to check perms. */
export async function deleteTrialFile(id: string): Promise<void> {
  const client = sb();
  const { data, error } = await client
    .from('trial_files').select('storage_path').eq('id', id).single();
  if (error) throw error;
  const path = (data as { storage_path: string | null }).storage_path;
  // Cascade will also drop child rows; collect their storage paths
  // first so we can clean up the bucket too.
  const { data: children } = await client
    .from('trial_files').select('storage_path').eq('parent_file_id', id);
  const paths = [path, ...((children ?? []) as { storage_path: string | null }[]).map((r) => r.storage_path)]
    .filter((p): p is string => !!p);
  if (paths.length) await client.storage.from('trial-files').remove(paths);
  const { error: delErr } = await client.from('trial_files').delete().eq('id', id);
  if (delErr) throw delErr;
}

// ── Weekly Trial Report recipients ───────────────────────────

export interface TrialReportRecipient {
  email: string;
  label: string | null;
  teams: TrialAccessTeam[];
  createdAt: string;
}
type RecipRow = { email: string; label: string | null; teams: TrialAccessTeam[]; created_at: string };

export async function listReportRecipients(): Promise<TrialReportRecipient[]> {
  const { data, error } = await sb()
    .from('trial_report_recipients').select('*').order('email');
  if (error) throw error;
  return (data as RecipRow[]).map((r) => ({
    email: r.email, label: r.label,
    teams: Array.isArray(r.teams) ? r.teams : ['monogastrics','ruminants','latam'],
    createdAt: r.created_at,
  }));
}

export async function upsertReportRecipient(r: {
  email: string; label?: string | null; teams?: TrialAccessTeam[];
}): Promise<void> {
  const payload = {
    email: r.email.trim().toLowerCase(),
    label: r.label ?? null,
    teams: r.teams ?? ['monogastrics','ruminants','latam'],
  };
  const { error } = await sb()
    .from('trial_report_recipients').upsert(payload, { onConflict: 'email' });
  if (error) throw error;
}

export async function deleteReportRecipient(email: string): Promise<void> {
  const { error } = await sb()
    .from('trial_report_recipients').delete().eq('email', email.trim().toLowerCase());
  if (error) throw error;
}

// ── Formatting helpers ───────────────────────────────────────

export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Maximum uploadable size per file, in bytes. 50 MB mirrors the
 *  Admin-Marketing product-files limit. */
export const TRIAL_FILE_MAX_BYTES = 50 * 1024 * 1024;
