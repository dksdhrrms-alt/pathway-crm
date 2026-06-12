import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';

/**
 * PATCH  /api/announcements/[id]   Admin/CEO — edit fields
 * DELETE /api/announcements/[id]   Admin/CEO — hard delete (cascades dismissals)
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const role = (session?.user as { role?: string })?.role;
  if (!canAuthor(role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null) as {
    title?: string; body?: string; severity?: string;
    active?: boolean; expiresAt?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === 'string') patch.title = body.title.trim();
  if (typeof body.body === 'string') patch.body = body.body.trim();
  if (body.severity && ['info', 'warning', 'critical'].includes(body.severity)) patch.severity = body.severity;
  if (typeof body.active === 'boolean') patch.active = body.active;
  if ('expiresAt' in body) patch.expires_at = body.expiresAt || null;

  const { data, error } = await sb().from('announcements').update(patch).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const role = (session?.user as { role?: string })?.role;
  if (!canAuthor(role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const { error } = await sb().from('announcements').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
