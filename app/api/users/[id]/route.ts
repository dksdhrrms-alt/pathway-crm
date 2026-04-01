import { NextResponse } from 'next/server';
import { updateStoreUser, getStoreUserById } from '@/lib/userStore';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth();
  if (error) return error;
  const { id } = await params;
  const updates = await request.json();
  const found = getStoreUserById(id);
  if (!found) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  updateStoreUser(id, updates);
  return NextResponse.json({ ok: true });
}
