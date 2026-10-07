import { NextResponse } from 'next/server';

/**
 * Self-signup endpoint — disabled.
 *
 * Accounts are now provisioned only by an administrator via
 * Admin → Users (see app/api/users). This route returns 410 Gone
 * so any stale client (bookmark, cached page, old form) sees a
 * clear error instead of silently failing.
 *
 * The /signup page redirects to /login — see app/signup/page.tsx.
 */

export const dynamic = 'force-dynamic';

const DISABLED = {
  error: 'Self-signup is disabled. Contact your administrator to request an account.',
} as const;

export async function POST() {
  return NextResponse.json(DISABLED, { status: 410 });
}

export async function GET() {
  return NextResponse.json(DISABLED, { status: 410 });
}
