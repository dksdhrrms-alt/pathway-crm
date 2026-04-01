import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = (session.user as { role?: string }).role || '';
  if (!['admin', 'administrative_manager', 'ceo'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, email, password, phone, role: userRole } = await request.json();

  if (!name || !email || !password || !userRole) {
    return NextResponse.json({ error: 'Name, email, password and role are required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const { data: existing } = await supabase.from('users').select('id').eq('email', email.toLowerCase().trim()).single();
  if (existing) {
    return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const initials = name.trim().split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

  const userId = `user-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { data: newUser, error } = await supabase.from('users').insert({
    id: userId,
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password: hashedPassword,
    phone: phone || '',
    role: userRole,
    initials,
    status: 'active',
  }).select().single();

  if (error) {
    return NextResponse.json({ error: 'Failed to create user: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, status: newUser.status },
  });
}
