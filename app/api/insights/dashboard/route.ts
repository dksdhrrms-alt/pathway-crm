/**
 * GET /api/insights/dashboard
 *
 * "What needs my attention today?" — five modules for a sales rep's
 * morning planning session. All computed server-side so the page paints
 * once with no client-side number crunching.
 *
 *   likelyReorder       — accounts predicted to order in next 14 days
 *   timeToCall          — accounts overdue for a touch, weighted by LTV
 *   closingThisMonth    — opps with close date in next 30 days, weighted by amount × probability
 *   personalTouchpoints — contact birthdays / anniversaries in next 14 days
 *   topSpendersWaiting  — high-LTV accounts that have gone quiet (45+ days)
 *
 * Each row includes accountId / contactId / opportunityId where applicable
 * so the page can deep-link straight to the detail view instead of the
 * filtered list view.
 *
 * Pure-rule first pass. No LLM calls — keeps the page snappy and the
 * results deterministic (sales reps need to trust the same input always
 * produces the same recommendations).
 */

import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// ── Tunable thresholds ────────────────────────────────────────────────
const MIN_ORDERS_FOR_CADENCE  = 3;
const REORDER_WINDOW_DAYS     = 14;
const TIME_TO_CALL_MIN_DAYS   = 30;     // hide accounts touched in the past month
const CLOSING_WINDOW_DAYS     = 30;     // "closing this month" really means "next 30 days"
const TOP_SPENDER_QUIET_DAYS  = 45;     // big account + this many quiet days = safety net
const TOP_SPENDER_LTV_FLOOR   = 50_000; // ignore tiny accounts even if they're quiet
const TOUCHPOINT_WINDOW_DAYS  = 14;     // birthdays / anniversaries lookahead
const MAX_ROWS_PER_MODULE     = 8;

// ── Types ─────────────────────────────────────────────────────────────

interface SaleRow {
  date?: string; amount?: number | string;
  account_name?: string; product_name?: string;
}
interface OppRow {
  id?: string; name?: string; account_id?: string; stage?: string;
  amount?: number | string; probability?: number | string;
  close_date?: string;
}
interface ActivityRow {
  id?: string; account_id?: string; date?: string; type?: string;
}
interface AccountRow {
  id?: string; name?: string;
}
interface ContactRow {
  id?: string; first_name?: string; last_name?: string;
  account_id?: string; birthday?: string; anniversary?: string;
}

interface ReorderItem {
  accountId: string;
  accountName: string;
  predictedDate: string;
  daysUntil: number;
  expectedAmount: number;
}
interface TimeToCallItem {
  accountId: string;
  accountName: string;
  daysSinceActivity: number;
  lastActivityType: string;
  lastActivityDate: string;
  lifetimeValue: number;
}
interface ClosingItem {
  opportunityId: string;
  name: string;
  accountId: string;
  accountName: string;
  stage: string;
  amount: number;
  probability: number;
  weightedAmount: number;
  closeDate: string;
  daysUntilClose: number;
}
interface TouchpointItem {
  contactId: string;
  contactName: string;
  accountId: string;
  accountName: string;
  type: 'birthday' | 'anniversary';
  date: string;       // MM-DD or YYYY-MM-DD
  daysUntil: number;
}
interface TopSpenderItem {
  accountId: string;
  accountName: string;
  lifetimeValue: number;
  daysSinceActivity: number;
  lastActivityType: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

const DAY = 86_400_000;

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / DAY);
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Days from `today` until the next occurrence of MM-DD (this year or next),
 *  ignoring the year in the stored date. Birthdays repeat annually. */
function daysUntilAnnual(stored: Date, today: Date): { days: number; nextOccurrence: Date } {
  const candidate = new Date(today.getFullYear(), stored.getMonth(), stored.getDate());
  if (candidate.getTime() < today.getTime() - DAY) {
    candidate.setFullYear(today.getFullYear() + 1);
  }
  const days = Math.round((candidate.getTime() - today.getTime()) / DAY);
  return { days, nextOccurrence: candidate };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) {
    return NextResponse.json({ error: 'Supabase env vars missing' }, { status: 500 });
  }
  const sb = createClient(url, key);

  const [s1, s2, s3, oppRes, actRes, acctRes, conRes] = await Promise.all([
    sb.from('sale_records').select('date,amount,account_name,product_name').range(0, 999),
    sb.from('sale_records').select('date,amount,account_name,product_name').range(1000, 1999),
    sb.from('sale_records').select('date,amount,account_name,product_name').range(2000, 2999),
    sb.from('opportunities').select('id,name,account_id,stage,amount,probability,close_date').range(0, 999),
    sb.from('activities').select('id,account_id,date,type').range(0, 1999),
    sb.from('accounts').select('id,name').range(0, 1999),
    sb.from('contacts').select('id,first_name,last_name,account_id,birthday,anniversary').range(0, 1999),
  ]);
  const sales      = [...(s1.data || []), ...(s2.data || []), ...(s3.data || [])] as SaleRow[];
  const opps       = (oppRes.data  || []) as OppRow[];
  const activities = (actRes.data  || []) as ActivityRow[];
  const accounts   = (acctRes.data || []) as AccountRow[];
  const contacts   = (conRes.data  || []) as ContactRow[];

  const accountIdByName = new Map<string, string>();
  const accountNameById = new Map<string, string>();
  for (const a of accounts) {
    const id = String(a.id ?? '');
    const name = String(a.name ?? '').trim();
    if (id && name) {
      accountIdByName.set(name, id);
      accountNameById.set(id, name);
    }
  }

  const today = new Date();

  // ── Per-account sales aggregation ─────────────────────────────────
  const byAccountName = new Map<string, Array<{ date: Date; amount: number }>>();
  for (const r of sales) {
    const d = parseDate(r.date);
    if (!d) continue;
    const name = String(r.account_name || '').trim();
    if (!name) continue;
    const amt = Number(r.amount) || 0;
    if (amt <= 0) continue;
    if (!byAccountName.has(name)) byAccountName.set(name, []);
    byAccountName.get(name)!.push({ date: d, amount: amt });
  }
  for (const arr of byAccountName.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Lifetime value per account name.
  const ltvByName = new Map<string, number>();
  for (const [name, orders] of byAccountName.entries()) {
    ltvByName.set(name, orders.reduce((s, o) => s + o.amount, 0));
  }

  // Latest activity per account ID (the join key on activities).
  const latestActivityByAccountId = new Map<string, { date: Date; type: string }>();
  for (const a of activities) {
    const d = parseDate(a.date);
    if (!d) continue;
    const id = String(a.account_id || '');
    if (!id) continue;
    const prev = latestActivityByAccountId.get(id);
    if (!prev || d > prev.date) {
      latestActivityByAccountId.set(id, { date: d, type: String(a.type || '—') });
    }
  }

  // ── Module 1: Likely to reorder ──────────────────────────────────
  const likelyReorder: ReorderItem[] = [];
  for (const [name, orders] of byAccountName.entries()) {
    if (orders.length < MIN_ORDERS_FOR_CADENCE) continue;
    const intervals: number[] = [];
    for (let i = 1; i < orders.length; i++) intervals.push(daysBetween(orders[i - 1].date, orders[i].date));
    const meanInt = mean(intervals);
    const sd = stddev(intervals);
    if (meanInt <= 0 || sd > meanInt) continue;     // erratic cadence → skip

    const lastOrder = orders[orders.length - 1].date;
    const predicted = new Date(lastOrder.getTime() + meanInt * DAY);
    const daysUntil = Math.round((predicted.getTime() - today.getTime()) / DAY);
    if (daysUntil < -3 || daysUntil > REORDER_WINDOW_DAYS) continue;

    const recent = orders.slice(-3);
    likelyReorder.push({
      accountId: accountIdByName.get(name) || '',
      accountName: name,
      predictedDate: fmtISO(predicted),
      daysUntil,
      expectedAmount: Math.round(mean(recent.map((o) => o.amount))),
    });
  }
  likelyReorder.sort((a, b) => b.expectedAmount - a.expectedAmount);
  likelyReorder.length = Math.min(likelyReorder.length, MAX_ROWS_PER_MODULE);

  // ── Module 2: Time to call ───────────────────────────────────────
  // Active accounts (any sales OR any open opp) that the team hasn't
  // touched in TIME_TO_CALL_MIN_DAYS days. Sorted by LTV so the
  // biggest "going quiet" accounts surface first.
  const activeAccountIds = new Set<string>();
  for (const name of byAccountName.keys()) {
    const id = accountIdByName.get(name);
    if (id) activeAccountIds.add(id);
  }
  for (const o of opps) {
    if (!String(o.stage || '').startsWith('Closed')) activeAccountIds.add(String(o.account_id || ''));
  }

  const timeToCall: TimeToCallItem[] = [];
  for (const accountId of activeAccountIds) {
    const name = accountNameById.get(accountId);
    if (!name) continue;
    const latest = latestActivityByAccountId.get(accountId);
    const daysSince = latest ? daysBetween(today, latest.date) : 9999;
    if (daysSince < TIME_TO_CALL_MIN_DAYS) continue;
    const ltv = ltvByName.get(name) || 0;
    timeToCall.push({
      accountId, accountName: name,
      daysSinceActivity: daysSince,
      lastActivityType: latest?.type || 'never',
      lastActivityDate: latest ? fmtISO(latest.date) : '—',
      lifetimeValue: Math.round(ltv),
    });
  }
  // Score = LTV × log(days) to surface big quiet accounts before tiny stale ones.
  timeToCall.sort((a, b) =>
    (b.lifetimeValue * Math.log(b.daysSinceActivity + 1)) -
    (a.lifetimeValue * Math.log(a.daysSinceActivity + 1)),
  );
  timeToCall.length = Math.min(timeToCall.length, MAX_ROWS_PER_MODULE);

  // ── Module 3: Closing this month ─────────────────────────────────
  const closing: ClosingItem[] = [];
  for (const o of opps) {
    const stage = String(o.stage || '');
    if (stage.startsWith('Closed')) continue;
    const close = parseDate(o.close_date);
    if (!close) continue;
    const daysUntilClose = Math.round((close.getTime() - today.getTime()) / DAY);
    if (daysUntilClose < -7 || daysUntilClose > CLOSING_WINDOW_DAYS) continue; // grace for slightly overdue

    const amount = Number(o.amount) || 0;
    const prob = Number(o.probability) || 0;
    const accountId = String(o.account_id || '');
    closing.push({
      opportunityId: String(o.id || ''),
      name: String(o.name || '—'),
      accountId,
      accountName: accountNameById.get(accountId) || '—',
      stage,
      amount: Math.round(amount),
      probability: Math.round(prob),
      weightedAmount: Math.round(amount * (prob / 100)),
      closeDate: fmtISO(close),
      daysUntilClose,
    });
  }
  closing.sort((a, b) => b.weightedAmount - a.weightedAmount);
  closing.length = Math.min(closing.length, MAX_ROWS_PER_MODULE);

  // ── Module 4: Personal touchpoints ───────────────────────────────
  const personalTouchpoints: TouchpointItem[] = [];
  for (const c of contacts) {
    const accountId = String(c.account_id || '');
    const accountName = accountNameById.get(accountId);
    if (!accountName) continue;
    // Skip contacts at accounts with no recent activity AND no orders ever —
    // sending a card to a dead account is wasted effort.
    if (!activeAccountIds.has(accountId)) continue;

    const name = `${(c.first_name || '').trim()} ${(c.last_name || '').trim()}`.trim() || '(unnamed)';
    for (const kind of ['birthday', 'anniversary'] as const) {
      const stored = parseDate(c[kind]);
      if (!stored) continue;
      const { days, nextOccurrence } = daysUntilAnnual(stored, today);
      if (days < 0 || days > TOUCHPOINT_WINDOW_DAYS) continue;
      personalTouchpoints.push({
        contactId: String(c.id || ''),
        contactName: name,
        accountId, accountName,
        type: kind,
        date: fmtISO(nextOccurrence),
        daysUntil: days,
      });
    }
  }
  personalTouchpoints.sort((a, b) => a.daysUntil - b.daysUntil);
  personalTouchpoints.length = Math.min(personalTouchpoints.length, MAX_ROWS_PER_MODULE);

  // ── Module 5: Top spenders waiting ───────────────────────────────
  // Big accounts (LTV ≥ floor) that have gone TOP_SPENDER_QUIET_DAYS+
  // days without an activity. Sorted by LTV so the biggest fish first.
  const topSpenders: TopSpenderItem[] = [];
  for (const [name, ltv] of ltvByName.entries()) {
    if (ltv < TOP_SPENDER_LTV_FLOOR) continue;
    const accountId = accountIdByName.get(name);
    if (!accountId) continue;
    const latest = latestActivityByAccountId.get(accountId);
    const daysSince = latest ? daysBetween(today, latest.date) : 9999;
    if (daysSince < TOP_SPENDER_QUIET_DAYS) continue;
    topSpenders.push({
      accountId, accountName: name,
      lifetimeValue: Math.round(ltv),
      daysSinceActivity: daysSince,
      lastActivityType: latest?.type || 'never',
    });
  }
  topSpenders.sort((a, b) => b.lifetimeValue - a.lifetimeValue);
  topSpenders.length = Math.min(topSpenders.length, MAX_ROWS_PER_MODULE);

  // ── Summary line ─────────────────────────────────────────────────
  const parts: string[] = [];
  if (likelyReorder.length)        parts.push(`${likelyReorder.length} likely to reorder`);
  if (timeToCall.length)           parts.push(`${timeToCall.length} need a call`);
  if (closing.length)              parts.push(`${closing.length} closing soon`);
  if (personalTouchpoints.length)  parts.push(`${personalTouchpoints.length} birthday${personalTouchpoints.length === 1 ? '' : 's'}/anniv.`);
  if (topSpenders.length)          parts.push(`${topSpenders.length} top account${topSpenders.length === 1 ? '' : 's'} waiting`);
  const summary = parts.length === 0
    ? 'Nothing flagged today. Pipeline looks healthy.'
    : parts.join(' · ');

  return NextResponse.json({
    summary,
    likelyReorder,
    timeToCall,
    closing,
    personalTouchpoints,
    topSpenders,
    generatedAt: new Date().toISOString(),
  });
}
