import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { summary } = await request.json();
    if (!summary) return Response.json({ error: 'No summary provided' }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.includes('placeholder')) {
      return Response.json({ error: 'AI service not configured' }, { status: 500 });
    }

    const prompt = `You are a sales analytics advisor for Pathway Intermediates USA, a livestock feed additive company.

Here is the current CRM data summary for ${summary.year || new Date().getFullYear()}:
- YTD Revenue: ${summary.ytdRevenue} (${summary.yoyGrowth} YoY growth)
- Open Pipeline: ${summary.openPipeline} across ${summary.activeDeals} deals
- Win Rate: ${summary.winRate}, Average Deal Size: ${summary.avgDealSize}
- Top Categories: ${summary.topCategories}
- Top Accounts: ${summary.topAccounts}
- Total Activities: ${summary.totalActivities}
- Inactive Accounts (30+ days): ${summary.inactiveAccounts}
- Overdue Tasks: ${summary.overdueTasks}

Provide 5-7 actionable insights and recommendations. Include:
1. Revenue trend analysis and forecast
2. Pipeline health assessment
3. Account engagement gaps
4. Category performance comparison
5. Specific action items for the sales team

Format each insight as a bullet point starting with an emoji icon.
Keep each point concise (1-2 sentences).
Write in professional but direct tone.`.replace(/[^\x00-\x7F]/g, ' ');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('[INSIGHTS] Claude API error:', res.status);
      return Response.json({ error: 'AI service error' }, { status: 500 });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    return Response.json({ success: true, insight: text });
  } catch (err) {
    console.error('[INSIGHTS] Error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
