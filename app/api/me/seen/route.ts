/**
 * POST /api/me/seen
 *
 * Tiny presence heartbeat — bumps users.last_seen_at = now() for the
 * currently signed-in user. The TopBar pings this every ~60s while
 * the tab is visible, so the admin Team Overview can show a real
 * "Last Active" column instead of the credentials-only Last Login
 * timestamp.
 *
 * Auth: requires a valid NextAuth session (no body needed).
 * No-op behaviors:
 *   - Unauthenticated request → 401, nothing written.
 *   - Supabase service-role key missing → 500 with a clear message
 *     (rather than silent fail) so the operator notices misconfig.
 *
 * Idempotent — calling it repeatedly is fine, the column just keeps
 * advancing.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!sbUrl || !sbKey) {
    return NextResponse.json({ ok: false, error: 'supabase service role key not configured' }, { status: 500 });
  }
  const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

  const nowIso = new Date().toISOString();
  const { error } = await sb.from('users').update({ last_seen_at: nowIso }).eq('id', userId);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, last_seen_at: nowIso });
}
