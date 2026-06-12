import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/announcements/[id]/dismiss
 *   Records that the current user has dismissed this announcement for 5 days.
 *   Upserts (announcement_id, user_id) → dismissed_until = now + 5d, so
 *   re-dismissing extends the window cleanly. The window is server-side so it
 *   follows the user across PC + mobile (the user's whole brief explicitly
 *   asked for cross-device dismissal).
 */

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SNOOZE_DAYS = 5;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { id } = await ctx.params;
  const until = new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString();

  const supabase = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
  const { error } = await supabase
    .from('announcement_dismissals')
    .upsert(
      { announcement_id: id, user_id: userId, dismissed_until: until, dismissed_at: new Date().toISOString() },
      { onConflict: 'announcement_id,user_id' }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, dismissed_until: until });
}
