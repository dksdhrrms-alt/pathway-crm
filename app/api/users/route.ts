import { NextResponse } from 'next/server';
import { getStoreUsers, addStoreUser } from '@/lib/userStore';
import { requireAuth } from '@/lib/api-auth';
import type { AppUser } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;
  return NextResponse.json(getStoreUsers());
}

export async function POST(request: Request) {
  const { error } = await requireAuth();
  if (error) return error;
  const user: AppUser = await request.json();
  const added = addStoreUser(user);
  if (!added) return NextResponse.json({ error: 'Email already registered.' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
