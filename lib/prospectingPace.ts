/**
 * Prospecting pace metric — the "am I hitting my sales discipline?"
 * check that the sales director asked for.
 *
 * Reports three windows for each activity type (Call / Email /
 * Meeting), all expressed as "events per business week (M-F)" so a
 * daily lull doesn't distort the picture:
 *
 *   - 5-day  → this week's total  (÷ 1 week)
 *   - 10-day → last 10 calendar days ÷ 2 weeks
 *   - 30-day → last 30 calendar days ÷ 4 weeks (director's own words)
 *
 * The unit is always "per week" so a rep can compare across the three
 * windows and see the trend at a glance: 5-day << 30-day means pace
 * is dropping recently even if the 30-day looks healthy.
 *
 * Trend arrow: compares the 5-day rate to the 30-day rate with a 20%
 * tolerance band so a normal day-to-day wobble doesn't paint every
 * row red.
 */

import type { Activity, ActivityType } from './data';

export type PaceTrend = 'up' | 'down' | 'flat';

export interface PaceRow {
  type: ActivityType;
  week1: number;   // events / week over last 5 days
  week2: number;   // events / week over last 10 days
  week4: number;   // events / week over last 30 days
  trend: PaceTrend;
}

// Per the director's clarification, the *divisor* is "weeks", not
// "days". 5 days = 1 week, 10 days = 2 weeks, 30 days = 4 weeks
// (he rounded, we honor his framing).
const WINDOWS: { days: number; weeks: number; key: 'week1' | 'week2' | 'week4' }[] = [
  { days: 5,  weeks: 1, key: 'week1' },
  { days: 10, weeks: 2, key: 'week2' },
  { days: 30, weeks: 4, key: 'week4' },
];

const TYPES: ActivityType[] = ['Call', 'Email', 'Meeting'];

function trendFor(week1: number, week4: number): PaceTrend {
  // Silent zone: if the 4-week baseline is essentially zero, don't
  // pretend we can measure a trend.
  if (week4 < 0.5) return 'flat';
  const pct = (week1 - week4) / week4;
  if (pct >= 0.2) return 'up';
  if (pct <= -0.2) return 'down';
  return 'flat';
}

/**
 * Compute the pace table for a single owner.
 *  - `activities` should be the full list you already have loaded;
 *    filter to the owner happens here for convenience.
 *  - `today` lets tests pass a fixed clock; pass new Date() from the app.
 */
export function computePace(
  activities: Activity[],
  ownerId: string,
  today: Date = new Date(),
): PaceRow[] {
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  // Bucket per (type × window) upfront in one pass to avoid the N×3×3 filter loop.
  const counts: Record<ActivityType, { week1: number; week2: number; week4: number }> = {
    Call:    { week1: 0, week2: 0, week4: 0 },
    Email:   { week1: 0, week2: 0, week4: 0 },
    Meeting: { week1: 0, week2: 0, week4: 0 },
    Note:    { week1: 0, week2: 0, week4: 0 }, // captured for completeness; not surfaced
  };

  for (const a of activities) {
    if (a.ownerId !== ownerId) continue;
    if (!a.date) continue;
    // Activity.date is 'YYYY-MM-DD' — parse as local midnight to avoid TZ drift.
    const [y, m, d] = a.date.split('-').map(Number);
    if (!y) continue;
    const ts = new Date(y, (m || 1) - 1, d || 1).getTime();
    const ageDays = (midnight - ts) / 86400000;
    if (ageDays < 0) continue; // future-dated; ignore
    const bucket = counts[a.type];
    if (!bucket) continue;
    for (const w of WINDOWS) {
      if (ageDays < w.days) bucket[w.key]++;
    }
  }

  return TYPES.map((type) => {
    const c = counts[type];
    const row: PaceRow = {
      type,
      week1: c.week1 / 1,
      week2: c.week2 / 2,
      week4: c.week4 / 4,
      trend: trendFor(c.week1 / 1, c.week4 / 4),
    };
    return row;
  });
}

/** One-decimal string; drops the ".0" when the number is a whole. */
export function fmtRate(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function trendGlyph(t: PaceTrend): string {
  return t === 'up' ? '↗' : t === 'down' ? '↘' : '→';
}
