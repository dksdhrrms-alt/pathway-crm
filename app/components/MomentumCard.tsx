'use client';

/**
 * MomentumCard — Dashboard widget that shows a rep their weekly
 * activity score, how it compares to the previous week, a 4-week
 * sparkline, and a breakdown of what fed the number. Also includes
 * a company-wide leaderboard (Dave's call: everybody sees everybody).
 *
 * Data source: user_weekly_momentum table (data-migration/40), rebuilt
 * nightly by /api/cron/weekly-momentum. Falls back to "—" when the
 * cron hasn't populated this week yet.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useUsers } from '@/lib/UserContext';
import { supabase, supabaseEnabled } from '@/lib/supabase';
import {
  mondayOf, previousMonday, formatDelta, pctDelta,
  type MomentumBreakdown,
} from '@/lib/momentum';

interface Row {
  user_id: string;
  week_start: string;
  score: number;
  breakdown: MomentumBreakdown | null;
}

export default function MomentumCard() {
  const { data: session } = useSession();
  const { users } = useUsers();
  const userId = session?.user?.id ?? '';

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllLeaderboard, setShowAllLeaderboard] = useState(false);

  // Pull the last 6 weeks across all users so we can draw a sparkline
  // for self AND rank the company for this week in a single round-trip.
  useEffect(() => {
    if (!supabaseEnabled) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      // Compute the floor date: 6 Mondays back from today.
      let cutoff = mondayOf(new Date());
      for (let i = 0; i < 5; i++) cutoff = previousMonday(cutoff);
      try {
        const { data, error } = await supabase
          .from('user_weekly_momentum')
          .select('user_id, week_start, score, breakdown')
          .gte('week_start', cutoff)
          .order('week_start', { ascending: false });
        if (!cancelled) {
          if (error) {
            console.error('[Momentum] load error:', error);
            setRows([]);
          } else {
            setRows((data as Row[]) || []);
          }
          setLoading(false);
        }
      } catch (e) {
        console.error('[Momentum] load threw:', e);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const thisMonday = mondayOf(new Date());
  const lastMonday = previousMonday(thisMonday);

  // My score + delta
  const myThisWeek = rows.find((r) => r.user_id === userId && r.week_start === thisMonday);
  const myLastWeek = rows.find((r) => r.user_id === userId && r.week_start === lastMonday);
  const myScore = myThisWeek?.score ?? 0;
  const delta = pctDelta(myScore, myLastWeek?.score ?? 0);

  // 4-week sparkline for the current user (newest right)
  const sparkWeeks = useMemo(() => {
    const result: { week: string; score: number }[] = [];
    let m = thisMonday;
    for (let i = 0; i < 4; i++) {
      const hit = rows.find((r) => r.user_id === userId && r.week_start === m);
      result.push({ week: m, score: hit?.score ?? 0 });
      m = previousMonday(m);
    }
    return result.reverse();
  }, [rows, userId, thisMonday]);

  // Company leaderboard: this week's scores for every user, sorted desc.
  const leaderboard = useMemo(() => {
    const byUser = new Map<string, number>();
    for (const r of rows) {
      if (r.week_start !== thisMonday) continue;
      byUser.set(r.user_id, r.score);
    }
    // Include every active user, even 0-scorers, so the picture is honest.
    const entries = users
      .filter((u) => u.status === 'active')
      .map((u) => ({
        userId: u.id,
        name: u.name,
        initials: u.initials || u.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2),
        score: byUser.get(u.id) ?? 0,
      }));
    entries.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return entries;
  }, [rows, users, thisMonday]);

  const myRank = leaderboard.findIndex((e) => e.userId === userId) + 1;
  const b = myThisWeek?.breakdown || null;

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
        <p className="text-sm text-gray-400">Loading momentum…</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Weekly Momentum</h2>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Mon {thisMonday} — Sun · updates nightly</p>
        </div>
        {myRank > 0 && leaderboard.length > 1 && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
            Rank #{myRank} of {leaderboard.length}
          </span>
        )}
      </div>

      {/* Big number + delta + sparkline */}
      <div className="flex items-end gap-5 mb-4">
        <div className="flex items-baseline gap-3">
          <span className="text-5xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{myScore}</span>
          <div className="flex flex-col">
            <span className={`text-sm font-semibold tabular-nums ${
              delta == null ? 'text-gray-400'
                : delta > 0 ? 'text-emerald-600 dark:text-emerald-400'
                : delta < 0 ? 'text-rose-600 dark:text-rose-400'
                : 'text-gray-500'
            }`}>
              {delta == null ? '—' : delta > 0 ? '▲' : delta < 0 ? '▼' : ''} {formatDelta(delta)}
            </span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">vs last week ({myLastWeek?.score ?? 0})</span>
          </div>
        </div>
        {/* Simple inline SVG sparkline (no library) */}
        <Sparkline points={sparkWeeks.map((w) => w.score)} />
      </div>

      {/* Breakdown — what fed the score this week */}
      {b && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-600 dark:text-gray-300 mb-4">
          {b.activities.Meeting > 0 && <span>🤝 <b>{b.activities.Meeting}</b> meeting{b.activities.Meeting > 1 ? 's' : ''}</span>}
          {b.activities.Call > 0 && <span>📞 <b>{b.activities.Call}</b> call{b.activities.Call > 1 ? 's' : ''}</span>}
          {b.activities.Email > 0 && <span>📧 <b>{b.activities.Email}</b> email{b.activities.Email > 1 ? 's' : ''}</span>}
          {b.activities.Note > 0 && <span>📝 <b>{b.activities.Note}</b> note{b.activities.Note > 1 ? 's' : ''}</span>}
          {b.tasksCompleted > 0 && <span>✅ <b>{b.tasksCompleted}</b> task{b.tasksCompleted > 1 ? 's' : ''}</span>}
          {b.trialUpdates > 0 && <span>🧪 <b>{b.trialUpdates}</b> trial update{b.trialUpdates > 1 ? 's' : ''}</span>}
          {b.oppsWon > 0 && <span className="text-emerald-700 dark:text-emerald-400 font-semibold">🏆 <b>{b.oppsWon}</b> Won!</span>}
          {b.activities.starred > 0 && <span className="text-amber-600 dark:text-amber-400">★ {b.activities.starred} starred</span>}
        </div>
      )}

      {/* Leaderboard — company-wide */}
      {leaderboard.length > 1 && (
        <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Team Leaderboard — This Week</h3>
            <button
              onClick={() => setShowAllLeaderboard((v) => !v)}
              className="text-[11px] text-emerald-700 dark:text-emerald-400 hover:underline"
            >
              {showAllLeaderboard ? 'Show top 5' : `Show all (${leaderboard.length})`}
            </button>
          </div>
          <ol className="space-y-1">
            {(showAllLeaderboard ? leaderboard : leaderboard.slice(0, 5)).map((e, i) => {
              const isMe = e.userId === userId;
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
              return (
                <li
                  key={e.userId}
                  className={`flex items-center gap-2 py-1 px-2 rounded ${
                    isMe ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''
                  }`}
                >
                  <span className="w-5 text-xs text-gray-500 tabular-nums">{medal || `${i + 1}.`}</span>
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0"
                    style={{ backgroundColor: isMe ? '#1a4731' : '#64748b' }}
                  >
                    {e.initials}
                  </span>
                  <span className={`flex-1 text-sm truncate ${isMe ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}>
                    {e.name}{isMe && <span className="ml-1 text-[10px] text-emerald-700 dark:text-emerald-400">(you)</span>}
                  </span>
                  <span className={`text-sm tabular-nums ${isMe ? 'font-semibold' : ''} text-gray-800 dark:text-gray-200`}>{e.score}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── Tiny inline sparkline — avoids a chart library dep for one widget.
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 120, h = 40, pad = 2;
  const max = Math.max(...points, 1);
  const dx = (w - pad * 2) / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = pad + i * dx;
      const y = h - pad - (p / max) * (h - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const lastX = pad + (points.length - 1) * dx;
  const lastY = h - pad - (points[points.length - 1] / max) * (h - pad * 2);
  return (
    <svg width={w} height={h} className="shrink-0" aria-label="4-week trend">
      <path d={path} fill="none" stroke="#10b981" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={3} fill="#10b981" />
    </svg>
  );
}
