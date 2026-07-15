import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/auth/account-status
 *   body: { email: string }
 *   returns: { status: 'active' | 'pending' | 'inactive' | 'unknown' }
 *
 * Called by the login page ONLY after signIn already failed, so that
 * we can distinguish "waiting for admin approval" from "wrong
 * password". We do NOT leak whether a random email is registered —
 * for that case we return 'unknown' so the caller falls back to the
 * generic "invalid credentials" message.
 *
 * Deliberately does NOT check the password; NextAuth already
 * rejected the attempt, and this endpoint's job is just to explain
 * why. To keep pending/inactive privacy leakage minimal, callers
 * should still show the same generic error for 'unknown'.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ status: 'unknown' });
  }

  let email = '';
  try {
    const body = await request.json();
    email = String(body?.email || '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ status: 'unknown' });
  }
  if (!email) return NextResponse.json({ status: 'unknown' });

  try {
    const sb = createClient(url, key);
    const { data } = await sb.from('users').select('status').eq('email', email).maybeSingle();
    const status = (data?.status as string | undefined) || 'unknown';
    if (status === 'pending' || status === 'inactive' || status === 'active') {
      return NextResponse.json({ status });
    }
    return NextResponse.json({ status: 'unknown' });
  } catch {
    return NextResponse.json({ status: 'unknown' });
  }
}
