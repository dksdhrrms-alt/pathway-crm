import { NextResponse } from 'next/server';
import { seedDatabase } from '@/lib/seed';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;
  const result = await seedDatabase();
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
