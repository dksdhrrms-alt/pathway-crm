import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel Cron sends this header)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) return Response.json({ error: 'No Supabase config' }, { status: 500 });

  const sb = createClient(url, key);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];

  try {
    // Fetch accounts and their latest activity
    const { data: accounts } = await sb.from('accounts').select('id, name, owner_id');
    const { data: activities } = await sb.from('activities').select('account_id, date').order('date', { ascending: false });

    if (!accounts || !activities) {
      return Response.json({ error: 'Failed to fetch data' }, { status: 500 });
    }

    // Find accounts not contacted in 14+ days
    const reminders: { accountId: string; accountName: string; ownerId: string; daysSince: number; message: string }[] = [];

    for (const acct of accounts) {
      const acctActs = activities.filter((a) => a.account_id === acct.id);
      const latestDate = acctActs.length > 0 ? acctActs[0].date : null;

      if (!latestDate || latestDate < thirtyDaysAgo) {
        const daysSince = latestDate
          ? Math.floor((now.getTime() - new Date(latestDate + 'T00:00:00').getTime()) / 86400000)
          : 999;
        reminders.push({
          accountId: acct.id,
          accountName: acct.name,
          ownerId: acct.owner_id || '',
          daysSince,
          message: daysSince === 999
            ? `${acct.name} has never been contacted. Schedule an initial outreach.`
            : `${acct.name} - last contact ${daysSince} days ago. Schedule a follow-up.`,
        });
      }
    }

    // Check for deals closing within 3 days with no recent activity
    const { data: opps } = await sb.from('opportunities').select('id, name, close_date, stage, account_id, owner_id, amount')
      .neq('stage', 'Closed Won').neq('stage', 'Closed Lost');

    if (opps) {
      const threeDaysFromNow = new Date(now.getTime() + 3 * 86400000).toISOString().split('T')[0];
      for (const opp of opps) {
        if (opp.close_date && opp.close_date <= threeDaysFromNow && opp.close_date >= now.toISOString().split('T')[0]) {
          const oppActs = activities.filter((a) => a.account_id === opp.account_id);
          const recentActivity = oppActs.some((a) => a.date >= sevenDaysAgo);
          if (!recentActivity) {
            reminders.push({
              accountId: opp.account_id || opp.id,
              accountName: opp.name,
              ownerId: opp.owner_id || '',
              daysSince: 0,
              message: `Deal "${opp.name}" ($${Number(opp.amount || 0).toLocaleString()}) closing soon but no recent activity. Follow up now!`,
            });
          }
        }
      }
    }

    // Check overdue tasks
    const today = now.toISOString().split('T')[0];
    const { data: overdueTasks } = await sb.from('tasks').select('id, subject, due_date, owner_id, related_account_id')
      .eq('status', 'Open').lt('due_date', today).limit(20);

    const overdueCount = overdueTasks?.length || 0;

    console.log(`[CRON] Follow-up check: ${reminders.length} reminders, ${overdueCount} overdue tasks`);

    return Response.json({
      success: true,
      timestamp: now.toISOString(),
      reminders: reminders.length,
      overdueTaskCount: overdueCount,
      details: reminders.slice(0, 10),
    });
  } catch (err) {
    console.error('[CRON] Follow-up check error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
