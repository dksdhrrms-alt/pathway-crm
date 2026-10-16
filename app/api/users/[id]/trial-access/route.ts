/**
 * PATCH /api/users/[id]/trial-access
 *
 * Admin-only endpoint that overwrites users.trial_access_teams for
 * one user. Body: { teams: ('monogastrics'|'ruminants'|'latam')[] }.
 *
 * We keep this on its own route (rather than extending the general
 * UpdateUserBodySchema) so the shape and the admin guard are
 * trivial to audit — this field is the thing that gates who can
 * read confidential trial materials.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { updateStoreUser, getStoreUserById } from '@/lib/userStore';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['monogastrics', 'ruminants', 'latam']);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error: authErr } = await requireAdmin();
  if (authErr) return authErr;

  const { id } = await params;
  const found = getStoreUserById(id);
  if (!found) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }
  const rawTeams = (body as { teams?: unknown }).teams;
  if (!Array.isArray(rawTeams)) {
    return NextResponse.json({ error: 'teams must be an array' }, { status: 400 });
  }
  const teams = rawTeams
    .filter((t): t is string => typeof t === 'string')
    .filter((t) => ALLOWED.has(t));

  // File-store copy (dev fallback)
  updateStoreUser(id, { trialAccessTeams: teams as ('monogastrics' | 'ruminants' | 'latam')[] });

  // Supabase copy — authoritative in production. We write here
  // explicitly (rather than relying only on updateStoreUser's
  // Supabase side-effect) because the dev file-store path doesn't
  // know this column exists.
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await sb.from('users').update({ trial_access_teams: teams }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, teams });
}
