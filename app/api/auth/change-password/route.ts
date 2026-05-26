import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { dbGetUserByEmail, dbUpdateUser } from '@/lib/db';
import { verifyPassword, hashPassword } from '@/lib/auth-utils';
import { parseBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/change-password
 *
 * Server-side password change. Replaces the previous client-side
 * `currentPassword === currentUser.password` check on /profile, which:
 *   1. Required the password hash to be shipped to the browser.
 *   2. Could never have worked once passwords were bcrypt-hashed
 *      (the client doesn't run bcrypt.compare).
 *   3. Trusted the client to enforce the rule.
 *
 * Now the route:
 *   - Requires an authenticated session.
 *   - Re-fetches the user row server-side from the session email.
 *   - Verifies `currentPassword` with bcrypt.compare (via verifyPassword,
 *     which also handles legacy plaintext rows).
 *   - Persists a fresh bcrypt hash with the configured rounds.
 */
const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters').max(200),
    confirm: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json(
      { error: 'Unauthorized — please log in' },
      { status: 401 }
    );
  }

  const { data, error: vErr } = await parseBody(request, ChangePasswordSchema);
  if (vErr) return vErr;

  const { currentPassword, newPassword } = data;

  // Look up the live user row — never trust the JWT for password material.
  const user = await dbGetUserByEmail(session.user.email);
  if (!user || !user.password) {
    // Generic message so we don't leak which accounts exist or how they
    // were provisioned.
    return NextResponse.json(
      { error: 'Current password is incorrect' },
      { status: 401 }
    );
  }

  const ok = await verifyPassword(currentPassword, user.password);
  if (!ok) {
    return NextResponse.json(
      { error: 'Current password is incorrect' },
      { status: 401 }
    );
  }

  try {
    const newHash = await hashPassword(newPassword);
    await dbUpdateUser(user.id, { password: newHash });
  } catch (err) {
    console.error('[change-password] Update failed:', err);
    return NextResponse.json(
      { error: 'Could not update password' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
