/**
 * Weekly Momentum cron — DISABLED (2026-10-15).
 *
 * The Momentum feature was removed from the Dashboard. The vercel.json
 * cron entry is also gone, so this endpoint should never be hit by
 * Vercel scheduling anymore. If anything bookmarked the URL and keeps
 * calling it (an old curl in someone's shell history), return 410 Gone
 * so the caller knows the feature is officially retired.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const RETIRED = { error: 'Weekly Momentum cron has been retired.' } as const;

export async function GET() {
  return NextResponse.json(RETIRED, { status: 410 });
}

export async function POST() {
  return NextResponse.json(RETIRED, { status: 410 });
}
