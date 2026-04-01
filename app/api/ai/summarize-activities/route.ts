import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { activities, type } = await request.json();
  void activities;
  void type;

  // TODO: Uncomment when ANTHROPIC_API_KEY is added to .env.local
  // const response = await fetch('https://api.anthropic.com/v1/messages', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'x-api-key': process.env.ANTHROPIC_API_KEY!,
  //     'anthropic-version': '2023-06-01',
  //   },
  //   body: JSON.stringify({
  //     model: 'claude-sonnet-4-20250514',
  //     max_tokens: 500,
  //     messages: [{ role: 'user', content: `Summarize these CRM activities...` }],
  //   }),
  // });

  return NextResponse.json({
    summary: 'AI summary coming soon. Add ANTHROPIC_API_KEY to enable.',
    ready: false,
  });
}
