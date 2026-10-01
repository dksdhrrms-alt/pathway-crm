/**
 * Activity attachments — upload + list + delete helpers for files
 * attached to an Activity. Follows the same pattern as
 * lib/productCatalog.ts (upload → public URL → write row linking the
 * two). Kept in its own file so lib/db.ts stays small.
 *
 * Storage bucket + schema are set up in
 *   data-migration/30-activity-attachments.sql
 */

import { createClient } from '@supabase/supabase-js';

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

const BUCKET = 'activity-attachments';

export interface ActivityAttachment {
  id: string;
  activityId: string;
  filename: string;
  url: string;
  sizeBytes: number;
  contentType: string | null;
  storagePath: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

type Row = {
  id: string;
  activity_id: string;
  filename: string;
  url: string;
  size_bytes: number | string;
  content_type: string | null;
  storage_path: string | null;
  uploaded_by: string | null;
  created_at: string;
};

function asRow(r: Row): ActivityAttachment {
  return {
    id: r.id,
    activityId: r.activity_id,
    filename: r.filename,
    url: r.url,
    sizeBytes: Number(r.size_bytes) || 0,
    contentType: r.content_type,
    storagePath: r.storage_path,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  };
}

/** Format bytes as a short human-readable string (12 KB / 3.4 MB). */
export function fmtBytes(n: number): string {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** List attachments for one activity. */
export async function listActivityAttachments(activityId: string): Promise<ActivityAttachment[]> {
  if (!activityId) return [];
  const { data, error } = await sb()
    .from('activity_attachments')
    .select('*')
    .eq('activity_id', activityId)
    .order('created_at');
  if (error) throw error;
  return (data as Row[]).map(asRow);
}

/** Fetch attachments for several activities at once (timeline view). */
export async function listAttachmentsFor(activityIds: string[]): Promise<Map<string, ActivityAttachment[]>> {
  const map = new Map<string, ActivityAttachment[]>();
  if (activityIds.length === 0) return map;
  const { data, error } = await sb()
    .from('activity_attachments')
    .select('*')
    .in('activity_id', activityIds)
    .order('created_at');
  if (error) throw error;
  for (const r of (data as Row[])) {
    const arr = map.get(r.activity_id) || [];
    arr.push(asRow(r));
    map.set(r.activity_id, arr);
  }
  return map;
}

/**
 * Upload a file to Storage and insert the metadata row. Returns the
 * new ActivityAttachment on success. Caller is expected to ensure
 * the Activity row already exists in the DB (otherwise the FK
 * constraint rejects the insert).
 */
export async function uploadActivityAttachment(
  file: File,
  activityId: string,
  opts: { uploadedBy?: string } = {},
): Promise<ActivityAttachment> {
  const client = sb();
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  // activityId/timestamp-filename keeps multiple uploads of the same
  // filename from colliding and makes storage-level cleanup obvious.
  const path = `${activityId}/${Date.now()}-${safeName}`;
  const up = await client.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    cacheControl: '3600',
    upsert: false,
  });
  if (up.error) throw up.error;
  const { data: pub } = client.storage.from(BUCKET).getPublicUrl(path);

  const payload = {
    activity_id: activityId,
    filename: file.name,
    url: pub.publicUrl,
    size_bytes: file.size,
    content_type: file.type || null,
    storage_path: path,
    uploaded_by: opts.uploadedBy || null,
  };
  const { data, error } = await client
    .from('activity_attachments')
    .insert(payload)
    .select('*')
    .single();
  if (error) {
    // Row insert failed — best-effort rollback of the Storage object
    // so we don't leave orphans.
    try { await client.storage.from(BUCKET).remove([path]); } catch { /* ignore */ }
    throw error;
  }
  return asRow(data as Row);
}

/**
 * Delete the DB row AND the Storage object. Storage removal is
 * best-effort — a row delete should still "work" from the user's
 * perspective even if the bucket is briefly unreachable.
 */
export async function deleteActivityAttachment(a: ActivityAttachment): Promise<void> {
  const client = sb();
  const { error } = await client.from('activity_attachments').delete().eq('id', a.id);
  if (error) throw error;
  if (a.storagePath) {
    try { await client.storage.from(BUCKET).remove([a.storagePath]); } catch { /* ignore */ }
  }
}
