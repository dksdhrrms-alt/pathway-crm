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

// 'common' is the cross-species shortcut (see lib/users.ts).
const ALLOWED = new Set(['monogastrics', 'ruminants', 'latam', 'common']);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error: authErr } = await requireAdmin();
  if (authErr) return authErr;

  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }
  const rawTeams = (body as { teams?: unknown }).teams;
  if (!Array.isArray(rawTeams)) {
    return NextResponse.json({ error: 'teams must be an array' }, { status: 400 });
  }
  const teams = rawTeams
    .filter((t): t is string => typeof t === 'string')
    .filter((t) => ALLOWED.has(t)) as ('monogastrics' | 'ruminants' | 'latam' | 'common')[];

  // Supabase is authoritative in production. Verify the user
  // exists there (rather than only in the dev file-store) and
  // then write. Older note said we checked the file-store first —
  // that broke the Admin → Trials save for every production user
  // whose row only lives in Supabase.
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let foundSomewhere = false;

  if (url && key) {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    // Confirm the user exists in Supabase first — gives a clean 404
    // when the id is bogus (typo, deleted user) instead of a
    // silent no-op update.
    const { data: existing, error: lookupErr } = await sb
      .from('users').select('id').eq('id', id).maybeSingle();
    if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    if (existing) {
      foundSomewhere = true;
      const { error } = await sb
        .from('users').update({ trial_access_teams: teams }).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Dev file-store fallback — only matters when Supabase isn't
  // configured. Keeps local `npm run dev` working against the
  // JSON fixture.
  if (getStoreUserById(id)) {
    foundSomewhere = true;
    updateStoreUser(id, { trialAccessTeams: teams });
  }

  if (!foundSomewhere) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, teams });
}
