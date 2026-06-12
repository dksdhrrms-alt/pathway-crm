import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/announcements/debug
 *
 * Diagnostic endpoint for when the popup doesn't appear as expected.
 * Returns, for the *current logged-in user*:
 *   - my role + id (so we can see what's actually in the session)
 *   - the raw announcement list (active, expires_at, all of it)
 *   - any dismissal rows the user has, with the dismissed_until field
 *   - the filtered "what should pop up right now" list, with reasons
 *
 * No role gate — any signed-in user can hit this to figure out why
 * they're not seeing a popup. The data exposed is only their own +
 * announcement bodies, both of which they'd see anyway.
 */
export const dynamic = 'force-dynamic';

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  const role   = (session?.user as { role?: string })?.role;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
  const nowIso = new Date().toISOString();

  const { data: all, error: e1 } = await sb
    .from('announcements')
    .select('id, title, body, severity, active, expires_at, created_by, created_at')
    .order('created_at', { ascending: false });
  if (e1) return NextResponse.json({ error: e1.message, where: 'announcements' }, { status: 500 });

  const { data: myDismissals, error: e2 } = await sb
    .from('announcement_dismissals')
    .select('announcement_id, dismissed_until, dismissed_at')
    .eq('user_id', userId);
  if (e2) return NextResponse.json({ error: e2.message, where: 'dismissals' }, { status: 500 });

  const dismissedMap = new Map<string, { dismissed_until: string; dismissed_at: string }>();
  (myDismissals || []).forEach((d) => dismissedMap.set(d.announcement_id, d));

  // Annotate each announcement with the reason it would / wouldn't pop up.
  const annotated = (all || []).map((a) => {
    const reasons: string[] = [];
    if (!a.active) reasons.push('not active');
    if (a.expires_at && a.expires_at <= nowIso) reasons.push('expired');
    const dis = dismissedMap.get(a.id);
    if (dis && dis.dismissed_until > nowIso) {
      reasons.push(`dismissed until ${dis.dismissed_until}`);
    }
    return {
      ...a,
      my_dismissal: dis || null,
      would_show: reasons.length === 0,
      hidden_because: reasons,
    };
  });

  return NextResponse.json({
    now: nowIso,
    me: { userId, role: role || '(none)' },
    total_announcements: all?.length || 0,
    my_dismissals_count: myDismissals?.length || 0,
    announcements: annotated,
  });
}
