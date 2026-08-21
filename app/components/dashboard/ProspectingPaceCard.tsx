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

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { Activity, Opportunity } from '@/lib/data';
import type { AppUser } from '@/lib/users';
import { computePace, fmtRate, trendGlyph, type PaceRow } from '@/lib/prospectingPace';

const TYPE_EMOJI: Record<string, string> = { Call: '📞', Email: '📧', Meeting: '🤝' };

// Sales-cycle stages surfaced in the "Pipeline" panel. The refined
// 7-stage set is authoritative; legacy labels (Prospecting /
// Qualification / Proposal / Negotiation) get folded in so any row
// the DB migration hasn't touched yet still lands in the right bucket.
const STAGE_GROUPS: { label: string; stages: string[] }[] = [
  { label: 'Prospect',           stages: ['Prospect', 'Prospecting'] },
  { label: 'Qualified',          stages: ['Qualified', 'Qualification'] },
  { label: 'Trial Started',      stages: ['Trial Started'] },
  { label: 'Trial Ended',        stages: ['Trial Ended', 'Proposal'] },
  { label: 'Results Successful', stages: ['Results Successful', 'Negotiation'] },
];

interface Props {
  activities: Activity[];
  opportunities: Opportunity[];
  currentUserId: string;
  currentUserName: string;
  isManager: boolean;      // if true, tabs for each team member + Team total
  teamMembers: AppUser[];  // ignored when !isManager
}

function fmtCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function ProspectingPaceCard({
  activities, opportunities, currentUserId, currentUserName, isManager, teamMembers,
}: Props) {
  // Default to viewing self; manager can flip between self / team member / Team.
  // useState only captures the initial value, so if `currentUserId`
  // arrives after the first render (session hydrates async) we'd get
  // stuck on an empty string and every filter would return zero.
  // Sync it in an effect so we always land on the real user id.
  const [selected, setSelected] = useState<string>(currentUserId);
  useEffect(() => {
    if (!selected && currentUserId) setSelected(currentUserId);
  }, [currentUserId, selected]);

  const isTeamAggregate = selected === '__team__';
  const memberIds = useMemo(() => new Set(teamMembers.map((u) => u.id)), [teamMembers]);

  // YTD actual sales pulled from sale_records (the invoiced sales
  // table the weekly report already uses) — NOT Closed Won
  // opportunities. sale_records.owner_name is a plain text column so
  // we key everything by normalized name.
  const [ytdRecords, setYtdRecords] = useState<{ ownerName: string; amount: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const yearStart = `${new Date().getFullYear()}-01-01`;
    // sale_records.date is stored as TEXT (YYYY-MM-DD) — string
    // comparison works because the format is lexicographic.
    sb.from('sale_records')
      .select('owner_name, amount, date')
      .gte('date', yearStart)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setYtdRecords(data.map((r: { owner_name?: string | null; amount?: number | null }) => ({
          ownerName: (r.owner_name || '').trim().toLowerCase(),
          amount: Number(r.amount) || 0,
        })));
      });
    return () => { cancelled = true; };
  }, []);

  // Owner filter shared by pace + pipeline + YTD panels so a manager
  // flipping the picker sees a consistent view.
  const ownerMatch = (ownerId: string) =>
    isTeamAggregate ? memberIds.has(ownerId) : ownerId === selected;

  const rows: PaceRow[] = useMemo(() => {
    if (isTeamAggregate) {
      // Aggregate = sum every teammate's counts. Easiest path: fake a
      // synthetic owner id, rewrite ownerId on the fly for the reducer.
      const mapped: Activity[] = activities
        .filter((a) => memberIds.has(a.ownerId))
        .map((a) => ({ ...a, ownerId: '__team__' }));
      return computePace(mapped, '__team__');
    }
    return computePace(activities, selected);
  }, [activities, selected, isTeamAggregate, memberIds]);

  // Names to match against sale_records.owner_name (which is text).
  // For "Team total" we accept every team member's name; for a single
  // rep we accept just theirs. All comparisons are lowercase-trimmed.
  const ownerNames = useMemo(() => {
    const names = new Set<string>();
    if (isTeamAggregate) {
      for (const u of teamMembers) if (u.name) names.add(u.name.trim().toLowerCase());
    } else if (selected === currentUserId) {
      if (currentUserName) names.add(currentUserName.trim().toLowerCase());
    } else {
      const u = teamMembers.find((m) => m.id === selected);
      if (u?.name) names.add(u.name.trim().toLowerCase());
    }
    return names;
  }, [selected, isTeamAggregate, teamMembers, currentUserId, currentUserName]);

  // Pipeline breakdown by canonical stage group + running totals.
  const pipeline = useMemo(() => {
    const mine = opportunities.filter((o) => ownerMatch(o.ownerId));
    const perStage = STAGE_GROUPS.map((grp) => {
      const inGroup = mine.filter((o) => grp.stages.includes(o.stage));
      return {
        label: grp.label,
        count: inGroup.length,
        amount: inGroup.reduce((s, o) => s + (Number(o.amount) || 0), 0),
      };
    });
    const totalOpen = perStage.reduce(
      (acc, r) => ({ count: acc.count + r.count, amount: acc.amount + r.amount }),
      { count: 0, amount: 0 },
    );
    // YTD sales = sum of actual invoiced amounts from sale_records
    // where the record's owner_name matches this rep (or any team
    // member for Team total). This is the number the sales team
    // reports to leadership — Closed Won opps was too optimistic and
    // never matched the sale records the team uploads monthly.
    const ytdSales = ytdRecords
      .filter((r) => ownerNames.has(r.ownerName))
      .reduce((s, r) => s + r.amount, 0);
    const ytdCount = ytdRecords.filter((r) => ownerNames.has(r.ownerName)).length;
    return { perStage, totalOpen, ytdSales, ytdCount };
  }, [opportunities, selected, isTeamAggregate, memberIds, ytdRecords, ownerNames]); // eslint-disable-line react-hooks/exhaustive-deps

  const trendColor = (t: PaceRow['trend']) =>
    t === 'up' ? 'text-emerald-600 dark:text-emerald-400'
      : t === 'down' ? 'text-red-600 dark:text-red-400'
      : 'text-gray-400 dark:text-gray-500';

  const anyDecliningStreak = rows.some((r) => r.trend === 'down' && r.week4 >= 1);
  // Zero-state hint. If everything is 0 we probably picked a viewer
  // who owns no activities / opps / sales (e.g. an admin looking at
  // themselves) — nudge them toward the rep picker instead of
  // leaving them staring at rows of zeros.
  const allZero = rows.every((r) => r.week1 === 0 && r.week2 === 0 && r.week4 === 0)
    && pipeline.totalOpen.count === 0
    && pipeline.ytdSales === 0;
  const viewingSelf = selected === currentUserId && !isTeamAggregate;

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

      {/* Pipeline & YTD panel — the second half of the sales-director
          requested "complete picture". Uses the same rep picker as
          the pace table above so managers see one holistic view per
          person. */}
      <div className="border-t border-gray-100 dark:border-slate-800">
        <div className="px-5 pt-4 pb-2 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">📊 Pipeline &amp; YTD</h3>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
              Open deals by stage plus this year&apos;s closed sales.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-right">
              <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Total Open</div>
              <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {pipeline.totalOpen.count} <span className="text-[11px] font-normal text-gray-400">deals · {fmtCompact(pipeline.totalOpen.amount)}</span>
              </div>
            </div>
            <div className="text-right pl-4 border-l border-gray-200 dark:border-slate-700">
              <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">YTD Sales</div>
              <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                {fmtCompact(pipeline.ytdSales)} <span className="text-[11px] font-normal text-emerald-600/70 dark:text-emerald-500/70">· {pipeline.ytdCount} sales records</span>
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto pb-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/60">
                <th className="text-left px-5 py-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Stage</th>
                <th className="text-right px-4 py-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Deals</th>
                <th className="text-right px-4 py-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Value</th>
                <th className="text-right px-5 py-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">% of pipeline</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.perStage.map((s) => {
                const pct = pipeline.totalOpen.amount > 0 ? (s.amount / pipeline.totalOpen.amount) * 100 : 0;
                const dim = s.count === 0;
                return (
                  <tr key={s.label} className="border-b border-gray-50 dark:border-slate-800 last:border-b-0">
                    <td className={`px-5 py-2 ${dim ? 'text-gray-400 dark:text-gray-600' : 'text-gray-800 dark:text-gray-100'}`}>{s.label}</td>
                    <td className={`text-right px-4 py-2 font-medium ${dim ? 'text-gray-400 dark:text-gray-600' : 'text-gray-900 dark:text-gray-100'}`}>{s.count}</td>
                    <td className={`text-right px-4 py-2 ${dim ? 'text-gray-400 dark:text-gray-600' : 'text-gray-700 dark:text-gray-300'}`}>{fmtCompact(s.amount)}</td>
                    <td className="text-right px-5 py-2">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-20 h-1.5 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                          <div className="h-full bg-[#1a4731] dark:bg-emerald-500" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                        <span className={`text-[11px] tabular-nums ${dim ? 'text-gray-400 dark:text-gray-600' : 'text-gray-600 dark:text-gray-400'}`}>{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {allZero && (
        <div className="px-5 py-2.5 bg-blue-50 dark:bg-blue-900/20 border-t border-blue-100 dark:border-blue-900/40 text-[12px] text-blue-800 dark:text-blue-200">
          {isManager && teamMembers.length > 0 ? (
            <>No activities or deals for <span className="font-medium">{viewingSelf ? 'you' : 'this rep'}</span> in the window.
            {viewingSelf && ' Try picking a teammate or Team total above.'}</>
          ) : (
            <>No activities or deals logged yet in the tracked window. Once you start logging calls / emails / meetings, this card will fill in.</>
          )}
        </div>
      )}

      {anyDecliningStreak && !isTeamAggregate && selected === currentUserId && (
        <div className="px-5 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-100 dark:border-amber-900/40 text-[12px] text-amber-800 dark:text-amber-200">
          Heads-up: your recent week is off your 4-week baseline on at least one activity.
          If the drop persists across the 10 and 30-day columns, take a hard look at what&apos;s getting in the way.
        </div>
      )}
    </div>
  );
}
