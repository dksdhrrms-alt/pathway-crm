import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';
import { getRoleLabel, UserRole } from '@/lib/users';

/**
 * Helper — for an array of announcement rows, look up each unique
 * created_by user id and attach a small `author` object so the popup
 * can display "Posted by <name> · <role>" instead of an opaque UUID.
 * Returns the rows with `author` annotation.
 */
type AnnouncementRow = {
  id: string; title: string; body: string; severity: string; active: boolean;
  expires_at: string | null; created_by: string; created_at: string; updated_at: string;
};
async function attachAuthors(
  // Loose `any` rather than the over-narrow `ReturnType<typeof createClient>` —
  // the strict generic from the client factory rejected the public-schema
  // Supabase instance we actually instantiate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  rows: AnnouncementRow[],
): Promise<(AnnouncementRow & { author: { id: string; name: string; role: string; role_label: string } | null })[]> {
  if (rows.length === 0) return [];
  const ids = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean)));
  if (ids.length === 0) return rows.map((r) => ({ ...r, author: null }));
  const { data: users } = await supabase
    .from('users')
    .select('id, name, role')
    .in('id', ids);
  const userMap = new Map<string, { id: string; name: string; role: string }>();
  // `users` is typed loosely (Supabase client is `any` in this helper);
  // explicit unknown cast then narrow per-element to satisfy strict mode.
  ((users || []) as unknown as { id: string; name: string; role: string }[]).forEach((u) => {
    userMap.set(u.id, u);
  });
  return rows.map((r) => {
    const u = userMap.get(r.created_by);
    if (!u) return { ...r, author: null };
    let label = u.role;
    try { label = getRoleLabel(u.role as UserRole); } catch { /* unknown role — fall back to raw */ }
    return { ...r, author: { id: u.id, name: u.name, role: u.role, role_label: label } };
  });
}

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
    const enriched = await attachAuthors(supabase, (data || []) as AnnouncementRow[]);
    return NextResponse.json({ items: enriched });
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

  const filtered = (anns as AnnouncementRow[]).filter((a) => !blocked.has(a.id));
  const items = await attachAuthors(supabase, filtered);
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
