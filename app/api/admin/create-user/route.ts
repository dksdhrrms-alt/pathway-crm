import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/api-auth';
import { parseBody, AdminCreateUserBodySchema } from '@/lib/validation';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { error: authErr } = await requireAdmin();
  if (authErr) return authErr;

  const { data, error: vErr } = await parseBody(request, AdminCreateUserBodySchema);
  if (vErr) return vErr;

  const { name, email, password, phone, role: userRole, status } = data;

  const { data: existing } = await supabase
    .from('users').select('id').eq('email', email).single();
  if (existing) {
    return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
  const userId = `user-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const { data: newUser, error } = await supabase.from('users').insert({
    id: userId,
    name,
    email,
    password: hashedPassword,
    phone: phone || '',
    role: userRole,
    initials,
    status: status || 'active',
  }).select().single();

  if (error) {
    // Log the real Supabase error server-side for debugging, but don't leak
    // database internals to the client.
    console.error('[admin/create-user] Insert failed:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, status: newUser.status },
  });
}
