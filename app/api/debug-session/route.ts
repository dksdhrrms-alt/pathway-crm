import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// Diagnostic endpoint: returns the caller's session shape. Admin-only since
// the response includes the raw token contents — useful for debugging RBAC
// issues but not safe to expose to every authenticated user, much less the
// public Internet.
export async function GET() {
  const { session, error } = await requireAdmin();
  if (error) return error;

  return NextResponse.json({
    hasSession: !!session,
    user: session?.user ?? null,
    raw: JSON.stringify(session),
  });
}
