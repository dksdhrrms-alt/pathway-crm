import { NextResponse } from 'next/server';
import { supabase, supabaseEnabled } from '@/lib/supabase';
import { addStoreUser } from '@/lib/userStore';
import { hashPassword } from '@/lib/auth-utils';

export const dynamic = 'force-dynamic';

// Simple rate limiter: 5 signups per IP per hour
const signupAttempts = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = signupAttempts.get(ip);
  if (!record || now > record.resetAt) {
    signupAttempts.set(ip, { count: 1, resetAt: now + 3600000 });
    return true;
  }
  if (record.count >= 5) return false;
  record.count++;
  return true;
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many signup attempts. Try again later.' }, { status: 429 });
  }

  const body = await request.json();
  const { name, email, password, phone, role, profilePhoto, initials } = body;

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const cleanEmail = email.toLowerCase().trim();
  const userId = `user-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const userInitials = initials || name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
  const hashedPw = await hashPassword(password);

  if (supabaseEnabled) {
    const { error } = await supabase.from('users').insert({
      id: userId, name, email: cleanEmail,
      password: hashedPw,
      phone: phone || '', role: role || 'sales',
      initials: userInitials, status: 'active',
      profile_photo: profilePhoto || null,
    });

    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // File store uses hashed password too
  addStoreUser({
    id: userId, name, email: cleanEmail, password: hashedPw,
    phone: phone || '', role: role || 'sales',
    initials: userInitials, status: 'active',
    profilePhoto: profilePhoto || null,
  });

  return NextResponse.json({ success: true, userId });
}
