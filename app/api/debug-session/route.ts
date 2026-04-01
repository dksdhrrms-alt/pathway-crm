import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  return NextResponse.json({
    hasSession: !!session,
    user: session?.user ?? null,
    raw: JSON.stringify(session),
  });
}
