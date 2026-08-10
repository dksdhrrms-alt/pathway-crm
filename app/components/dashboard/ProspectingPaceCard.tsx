'use client';

/**
 * Prospecting Pace card — sales-director-requested self-coaching
 * mirror. Renders the 3×3 table (Call/Email/Meeting × 5-day/10-day/
 * 30-day weekly-averaged) for the current user and, when the viewer
 * is a manager, adds a picker to inspect each team member and the
 * team total.
 *
 * The math lives in lib/prospectingPace.ts — this component is just
 * layout, tabs, and colored trend arrows.
 */

import { useMemo, useState } from 'react';
import type { Activity } from '@/lib/data';
import type { AppUser } from '@/lib/users';
import { computePace, fmtRate, trendGlyph, type PaceRow } from '@/lib/prospectingPace';

const TYPE_EMOJI: Record<string, string> = { Call: '📞', Email: '📧', Meeting: '🤝' };

interface Props {
  activities: Activity[];
  currentUserId: string;
  currentUserName: string;
  isManager: boolean;      // if true, tabs for each team member + Team total
  teamMembers: AppUser[];  // ignored when !isManager
}

export default function ProspectingPaceCard({
  activities, currentUserId, currentUserName, isManager, teamMembers,
}: Props) {
  // Default to viewing self; manager can flip between self / team member / Team.
  const [selected, setSelected] = useState<string>(currentUserId);

  const isTeamAggregate = selected === '__team__';

  const rows: PaceRow[] = useMemo(() => {
    if (isTeamAggregate) {
      // Aggregate = sum every teammate's counts. Easiest path: fake a
      // synthetic owner id, rewrite ownerId on the fly for the reducer.
      const memberIds = new Set(teamMembers.map((u) => u.id));
      const mapped: Activity[] = activities
        .filter((a) => memberIds.has(a.ownerId))
        .map((a) => ({ ...a, ownerId: '__team__' }));
      return computePace(mapped, '__team__');
    }
    return computePace(activities, selected);
  }, [activities, selected, isTeamAggregate, teamMembers]);

  const trendColor = (t: PaceRow['trend']) =>
    t === 'up' ? 'text-emerald-600 dark:text-emerald-400'
      : t === 'down' ? 'text-red-600 dark:text-red-400'
      : 'text-gray-400 dark:text-gray-500';

  const anyDecliningStreak = rows.some((r) => r.trend === 'down' && r.week4 >= 1);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-hidden mb-6">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🎯 Prospecting Pace</h2>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            Events per business week (M-F). If all three columns trend the same way, that&apos;s your signal.
          </p>
        </div>
        {isManager && teamMembers.length > 0 && (
          <div className="inline-flex bg-gray-100 dark:bg-slate-800 p-1 rounded-md flex-wrap">
            <button
              onClick={() => setSelected(currentUserId)}
              className={`px-2.5 py-1 text-xs rounded ${selected === currentUserId ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400'}`}
            >Me</button>
            {teamMembers.filter((u) => u.id !== currentUserId).map((u) => (
              <button key={u.id} onClick={() => setSelected(u.id)}
                className={`px-2.5 py-1 text-xs rounded ${selected === u.id ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                {u.name.split(' ')[0]}
              </button>
            ))}
            <button onClick={() => setSelected('__team__')}
              className={`px-2.5 py-1 text-xs rounded ${selected === '__team__' ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
              Team total
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/60">
              <th className="text-left px-5 py-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Activity</th>
              <th className="text-right px-4 py-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">This week</th>
              <th className="text-right px-4 py-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">2-week avg</th>
              <th className="text-right px-4 py-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">4-week avg</th>
              <th className="text-center px-4 py-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type} className="border-b border-gray-50 dark:border-slate-800 last:border-b-0">
                <td className="px-5 py-2.5">
                  <span className="mr-1.5">{TYPE_EMOJI[r.type] || ''}</span>
                  <span className="text-sm text-gray-800 dark:text-gray-100 font-medium">{r.type}s</span>
                </td>
                <td className="text-right px-4 py-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {fmtRate(r.week1)}<span className="text-[10px] font-normal text-gray-400 dark:text-gray-500 ml-1">/wk</span>
                </td>
                <td className="text-right px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                  {fmtRate(r.week2)}<span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1">/wk</span>
                </td>
                <td className="text-right px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                  {fmtRate(r.week4)}<span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1">/wk</span>
                </td>
                <td className={`text-center px-4 py-2.5 text-base font-bold ${trendColor(r.trend)}`}
                    title={r.trend === 'up' ? '5-day pace is up 20%+ vs 4-week baseline'
                          : r.trend === 'down' ? '5-day pace is down 20%+ vs 4-week baseline'
                          : 'Within 20% of the 4-week baseline'}>
                  {trendGlyph(r.trend)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {anyDecliningStreak && !isTeamAggregate && selected === currentUserId && (
        <div className="px-5 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-100 dark:border-amber-900/40 text-[12px] text-amber-800 dark:text-amber-200">
          Heads-up: your recent week is off your 4-week baseline on at least one activity.
          If the drop persists across the 10 and 30-day columns, take a hard look at what&apos;s getting in the way.
        </div>
      )}
    </div>
  );
}
