import { NextResponse } from 'next/server';
import { supabase, supabaseEnabled } from '@/lib/supabase';
import { hashPassword } from '@/lib/auth-utils';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const { error: authErr } = await requireAdmin();
  if (authErr) return authErr;
  if (!supabaseEnabled) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 400 });
  }

  const { data: users, error } = await supabase.from('users').select('id, password');
  if (error || !users) {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }

  let migrated = 0;
  let skipped = 0;

  for (const user of users) {
    if (user.password?.startsWith('$2b$') || user.password?.startsWith('$2a$')) {
      skipped++;
      continue;
    }
    const hashed = await hashPassword(user.password || 'changeme123');
    await supabase.from('users').update({ password: hashed }).eq('id', user.id);
    migrated++;
  }

  return NextResponse.json({ success: true, migrated, skipped, message: `${migrated} passwords hashed, ${skipped} already secure` });
}
