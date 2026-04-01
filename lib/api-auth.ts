import { auth } from '@/auth';
import { NextResponse } from 'next/server';

const ADMIN_ROLES = ['admin', 'administrative_manager', 'ceo'];

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    return {
      session: null,
      error: NextResponse.json({ error: 'Unauthorized — please log in' }, { status: 401 }),
    };
  }
  return { session, error: null };
}

export async function requireAdmin() {
  const { session, error } = await requireAuth();
  if (error) return { session: null, error };
  if (!ADMIN_ROLES.includes(session!.user.role as string)) {
    return {
      session: null,
      error: NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 }),
    };
  }
  return { session, error: null };
}
