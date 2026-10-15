/**
 * Weekly Momentum rebuild — nightly cron.
 *
 * For every active user, aggregates activities/tasks/trial_updates/opps
 * in the current week AND the previous week, feeds them into
 * computeWeeklyScore (lib/momentum.ts), and upserts the result into
 * user_weekly_momentum (data-migration/40).
 *
 * Two weeks (not just the current one) because late-logged activities
 * — "I'm logging Friday's meeting on Monday morning" — need to retro-
 * populate the week they actually happened in, otherwise the leader-
 * board drifts away from reality.
 *
 * Auth: Vercel cron attaches `Authorization: Bearer ${CRON_SECRET}`.
 * Writes go through the SERVICE_ROLE_KEY so RLS doesn't filter.
 */

import { createClient } from '@supabase/supabase-js';
import {
  computeWeeklyScore, mondayOf, previousMonday, weekRangeFromMonday,
  type MomentumInputRow,
} from '@/lib/momentum';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  // 1. Auth check
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Supabase service-role client (bypasses RLS)
  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || '';
  if (!sbUrl || !sbKey) {
    return Response.json({ error: 'Missing Supabase env' }, { status: 500 });
  }
  const sb = createClient(sbUrl, sbKey);

  // 3. Figure out which two weeks to rebuild
  const now = new Date();
  const currentMonday = mondayOf(now);
  const prevMonday = previousMonday(currentMonday);
  const weeks = [prevMonday, currentMonday];

  // 4. Fetch rows for the oldest Monday's start → current week's Sunday
  //    (one wide window, filter per-week in memory per user).
  const windowStart = prevMonday;
  const windowEnd = weekRangeFromMonday(currentMonday).endISO;

  // Only active users contribute to the leaderboard
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: usersRaw } = await sb.from('users').select('id,status').eq('status', 'active');
  const users = (usersRaw || []) as { id: string }[];
  if (users.length === 0) {
    return Response.json({ ok: true, rebuilt: 0, weeks });
  }

  // Pull the four source tables once, filter by date in-memory.
  const [actsRes, tasksRes, trialsRes, oppsRes] = await Promise.all([
    sb.from('activities')
      .select('id, owner_id, type, date, is_important')
      .gte('date', windowStart).lte('date', windowEnd),
    sb.from('tasks')
      .select('id, owner_id, status, updated_at, due_date')
      .eq('status', 'Completed')
      .gte('updated_at', windowStart + 'T00:00:00')
      .lte('updated_at', windowEnd + 'T23:59:59'),
    sb.from('trial_updates')
      .select('id, created_by, week_ending')
      .gte('week_ending', windowStart).lte('week_ending', windowEnd),
    sb.from('opportunities')
      .select('id, owner_id, stage, close_date')
      .eq('stage', 'Won')
      .gte('close_date', windowStart).lte('close_date', windowEnd),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acts = (actsRes.data || []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = (tasksRes.data || []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trials = (trialsRes.data || []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opps = (oppsRes.data || []) as any[];

  // 5. Build and upsert one row per (user, week)
  const upserts: {
    user_id: string; week_start: string; score: number; breakdown: unknown; updated_at: string;
  }[] = [];
  const nowIso = new Date().toISOString();

  for (const u of users) {
    for (const weekMon of weeks) {
      const { startISO, endISO } = weekRangeFromMonday(weekMon);
      const inWindow = (iso: string | null | undefined) =>
        !!iso && iso.slice(0, 10) >= startISO && iso.slice(0, 10) <= endISO;

      const rows: MomentumInputRow[] = [];

      for (const a of acts) {
        if (a.owner_id !== u.id) continue;
        if (!inWindow(a.date)) continue;
        rows.push({ type: 'activity', activityType: a.type, isImportant: !!a.is_important });
      }
      for (const t of tasks) {
        if (t.owner_id !== u.id) continue;
        // Task "completed in this week" = updated_at falls in window.
        if (!inWindow(t.updated_at)) continue;
        rows.push({ type: 'task' });
      }
      for (const tu of trials) {
        if (tu.created_by !== u.id) continue;
        if (!inWindow(tu.week_ending)) continue;
        rows.push({ type: 'trial_update' });
      }
      for (const o of opps) {
        if (o.owner_id !== u.id) continue;
        if (!inWindow(o.close_date)) continue;
        rows.push({ type: 'opp_won' });
      }

      const { score, breakdown } = computeWeeklyScore(rows);
      upserts.push({
        user_id: u.id,
        week_start: weekMon,
        score,
        breakdown,
        updated_at: nowIso,
      });
    }
  }

  if (upserts.length === 0) {
    return Response.json({ ok: true, rebuilt: 0, weeks, users: users.length });
  }

  const { error: upErr } = await sb
    .from('user_weekly_momentum')
    .upsert(upserts, { onConflict: 'user_id,week_start' });
  if (upErr) {
    return Response.json({ ok: false, error: upErr.message, weeks }, { status: 500 });
  }

  return Response.json({
    ok: true,
    rebuilt: upserts.length,
    users: users.length,
    weeks,
  });
}
