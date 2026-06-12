import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';

/**
 * GET  /api/announcements
 *   Returns the list of announcements the *current user* should see right now
 *   (active, not expired, not dismissed-within-window). Used by the Home popup.
 *
 * POST /api/announcements
 *   Admin/CEO only. Creates a new announcement.
 */

// Mark dynamic so Vercel doesn't prerender this route at build time.
// Without this the route can return an empty cached payload until
// the cache TTL expires — which masked the popup not appearing.
export const dynamic = 'force-dynamic';

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(sbUrl, sbKey, { auth: { persistSession: false } });
}

function canAuthor(role: string | undefined): boolean {
  // Admin-tier authoring. The CRM uses two related roles:
  //   'admin'                  — the literal 'Admin' role
  //   'administrative_manager' — labeled 'Admin Manager' in the UI
  // Both should be allowed alongside CEO. Earlier version only
  // accepted 'admin' which locked out actual admin-manager accounts.
  return role === 'admin' || role === 'administrative_manager' || role === 'ceo';
}

export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  const role = (session?.user as { role?: string })?.role;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = sb();
  const nowIso = new Date().toISOString();

  // `?all=1` is the admin authoring view — it returns inactive + expired
  // rows too so the /admin/announcements management screen can list and
  // edit them. Only Admin/CEO may use that mode; everyone else gets the
  // user-facing filter (active + unexpired + not-dismissed-by-me).
  const url = new URL(req.url);
  const wantAll = url.searchParams.get('all') === '1';
  if (wantAll && !canAuthor(role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (wantAll) {
    const { data, error } = await supabase
      .from('announcements')
      .select('id, title, body, severity, active, expires_at, created_by, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ items: data || [] });
  }

  // User-facing path: active + unexpired only.
  const { data: anns, error } = await supabase
    .from('announcements')
    .select('id, title, body, severity, active, expires_at, created_by, created_at, updated_at')
    .eq('active', true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!anns || anns.length === 0) return NextResponse.json({ items: [] });

  // Filter out any the current user has dismissed within the window
  const ids = anns.map((a) => a.id);
  const { data: dismissals } = await supabase
    .from('announcement_dismissals')
    .select('announcement_id, dismissed_until')
    .in('announcement_id', ids)
    .eq('user_id', userId)
    .gt('dismissed_until', nowIso);
  const blocked = new Set((dismissals || []).map((d) => d.announcement_id));

  const items = anns.filter((a) => !blocked.has(a.id));
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  const role = (session?.user as { role?: string })?.role;
  if (!userId || !canAuthor(role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as {
    title?: string; body?: string; severity?: string;
    active?: boolean; expiresAt?: string | null;
  } | null;
  if (!body || !body.title?.trim() || !body.body?.trim()) {
    return NextResponse.json({ error: 'title and body are required' }, { status: 400 });
  }
  const severity = ['info', 'warning', 'critical'].includes(body.severity || '')
    ? body.severity!
    : 'info';

  const supabase = sb();
  const { data, error } = await supabase
    .from('announcements')
    .insert({
      title: body.title.trim(),
      body: body.body.trim(),
      severity,
      active: body.active !== false,
      expires_at: body.expiresAt || null,
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
