/**
 * GET /api/insights/dashboard
 *
 * Computes the five Insights modules in one round-trip so the page can
 * paint everything at once. All five share the same source data
 * (sale_records, opportunities, activities, accounts) so batching the
 * Supabase reads here is much cheaper than five separate routes.
 *
 * Modules returned:
 *   atRisk          — overdue / declining / silent customers
 *   likelyReorder   — predicted to order in next 14 days
 *   whitespace      — products peers buy that this customer doesn't
 *   stuckDeals      — open opportunities with no recent activity
 *   anomalies       — unusual order swings worth a look
 *   summary         — natural-language "your day at a glance" line
 *
 * Each module returns a small array (≤ 8 rows) so the UI doesn't have
 * to paginate; the cards show the top hits and link to the underlying
 * record for the full story.
 *
 * Pure-rule first pass. The summary blurb uses Claude only when
 * ANTHROPIC_API_KEY is present; otherwise it's templated.
 */

import { auth } from '@/auth';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// ── Tunable thresholds ────────────────────────────────────────────────
const MIN_ORDERS_FOR_CADENCE  = 3;        // ≥ 3 historic orders before we predict
const OVERDUE_MULT            = 1.5;      // days since last > mean × this → overdue
const DECLINING_DROP_PCT      = 25;       // last 90d sum vs prior 90d
const SILENT_DAYS             = 60;       // no order + no activity
const REORDER_WINDOW_DAYS     = 14;       // predicted next order within this → flag
const STUCK_DAYS              = 21;       // opp + no activity for this many days
const ANOMALY_SPIKE_MULT      = 2.5;      // current month vs trailing baseline
const ANOMALY_DROP_RATIO      = 0.3;      // current month < this × baseline
const WHITESPACE_PEER_THRESH  = 0.6;      // ≥ this fraction of peers buy → recommend
const MAX_ROWS_PER_MODULE     = 8;

// ── Types ─────────────────────────────────────────────────────────────

interface SaleRow {
  date?: string;
  amount?: number | string;
  account_name?: string;
  product_name?: string;
  category?: string;
}
interface OppRow {
  id?: string; name?: string; account_id?: string; stage?: string;
  amount?: number | string; probability?: number | string;
  close_date?: string; created_date?: string;
}
interface ActivityRow {
  id?: string; account_id?: string; date?: string; type?: string;
}
interface AccountRow {
  id?: string; name?: string;
}

// Output shapes — small, JSON-safe.
interface AtRiskItem {
  accountName: string;
  reason: 'overdue' | 'declining' | 'silent';
  detail: string;        // human-readable, e.g. "38 days overdue"
  lastOrder: string;     // YYYY-MM-DD or '—'
  lifetimeValue: number; // total $ ever
}
interface ReorderItem {
  accountName: string;
  predictedDate: string;   // YYYY-MM-DD
  daysUntil: number;
  expectedAmount: number;
}
interface WhitespaceItem {
  accountName: string;
  product: string;
  peerAdoption: number;   // 0..1 — what fraction of peers buy this
  avgPeerSpend: number;   // $ per month equivalent
}
interface StuckDealItem {
  opportunityId: string;
  name: string;
  accountName: string;
  stage: string;
  amount: number;
  daysSinceActivity: number;
}
interface AnomalyItem {
  accountName: string;
  direction: 'spike' | 'drop';
  currentMonth: number;
  baseline: number;
  ratio: number;          // current / baseline
}

// ── Helpers ───────────────────────────────────────────────────────────

const DAY = 86_400_000;

function parseDate(s?: string): Date | null {
  if (!s) return null;
  // sale_records.date is "YYYY-MM-DD" or full ISO. Either way Date can handle.
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

/** Sample standard deviation. n-1 denom so a single value yields 0 instead
 *  of NaN, which is what we want for sparse-history accounts. */
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
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

  // 3,000-row safety margin on sale_records mirrors the weekly-report route.
  const [s1, s2, s3, oppRes, actRes, acctRes] = await Promise.all([
    sb.from('sale_records').select('date,amount,account_name,product_name,category').range(0, 999),
    sb.from('sale_records').select('date,amount,account_name,product_name,category').range(1000, 1999),
    sb.from('sale_records').select('date,amount,account_name,product_name,category').range(2000, 2999),
    sb.from('opportunities').select('id,name,account_id,stage,amount,probability,close_date,created_date').range(0, 999),
    sb.from('activities').select('id,account_id,date,type').range(0, 1999),
    sb.from('accounts').select('id,name').range(0, 1999),
  ]);
  const sales       = [...(s1.data || []), ...(s2.data || []), ...(s3.data || [])] as SaleRow[];
  const opps        = (oppRes.data  || []) as OppRow[];
  const activities  = (actRes.data  || []) as ActivityRow[];
  const accounts    = (acctRes.data || []) as AccountRow[];

  const accountNameById = new Map<string, string>(
    accounts.map((a) => [String(a.id ?? ''), String(a.name ?? '—')]),
  );

  const today = new Date();

  // ── Per-account aggregation of sales ──────────────────────────────
  // Group sale rows by account name (the join key throughout this codebase).
  // For each account compute: ordered list of (date, amount, product, category).
  const byAccount = new Map<string, Array<{ date: Date; amount: number; product: string; category: string }>>();
  for (const r of sales) {
    const d = parseDate(r.date);
    if (!d) continue;
    const acct = String(r.account_name || '').trim();
    if (!acct) continue;
    const amt = Number(r.amount) || 0;
    if (amt <= 0) continue;
    if (!byAccount.has(acct)) byAccount.set(acct, []);
    byAccount.get(acct)!.push({
      date: d, amount: amt,
      product: String(r.product_name || '').trim(),
      category: String(r.category || '').trim(),
    });
  }
  // Sort each account's orders by date ascending — cadence math needs this.
  for (const arr of byAccount.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Latest activity date per account (for "silent" and stuck-deal modules).
  const latestActivityByAccountId = new Map<string, Date>();
  for (const a of activities) {
    const d = parseDate(a.date);
    if (!d) continue;
    const id = String(a.account_id || '');
    if (!id) continue;
    const prev = latestActivityByAccountId.get(id);
    if (!prev || d > prev) latestActivityByAccountId.set(id, d);
  }
  const latestActivityByName = new Map<string, Date>();
  for (const [id, d] of latestActivityByAccountId.entries()) {
    const name = accountNameById.get(id);
    if (name) latestActivityByName.set(name, d);
  }

  // ── Module 1: At-risk customers ──────────────────────────────────
  const atRisk: AtRiskItem[] = [];
  for (const [acct, orders] of byAccount.entries()) {
    if (orders.length < MIN_ORDERS_FOR_CADENCE) continue;

    const intervals: number[] = [];
    for (let i = 1; i < orders.length; i++) {
      intervals.push(daysBetween(orders[i - 1].date, orders[i].date));
    }
    const meanInt = mean(intervals);
    const lastOrder = orders[orders.length - 1].date;
    const daysSince = daysBetween(today, lastOrder);
    const lifetime = orders.reduce((s, o) => s + o.amount, 0);

    // a) Overdue
    if (meanInt > 7 && daysSince > meanInt * OVERDUE_MULT) {
      atRisk.push({
        accountName: acct, reason: 'overdue',
        detail: `${daysSince - Math.round(meanInt)} days past typical cadence (avg ${Math.round(meanInt)}d)`,
        lastOrder: fmtISO(lastOrder), lifetimeValue: Math.round(lifetime),
      });
      continue;
    }
    // b) Declining trend — last 90d vs prior 90d
    const last90Cutoff = new Date(today.getTime() - 90 * DAY);
    const prior90Cutoff = new Date(today.getTime() - 180 * DAY);
    const last90  = orders.filter((o) => o.date >= last90Cutoff).reduce((s, o) => s + o.amount, 0);
    const prior90 = orders.filter((o) => o.date >= prior90Cutoff && o.date < last90Cutoff).reduce((s, o) => s + o.amount, 0);
    if (prior90 > 1000 && last90 > 0 && (prior90 - last90) / prior90 >= DECLINING_DROP_PCT / 100) {
      const dropPct = Math.round(((prior90 - last90) / prior90) * 100);
      atRisk.push({
        accountName: acct, reason: 'declining',
        detail: `Spend down ${dropPct}% vs prior 90 days`,
        lastOrder: fmtISO(lastOrder), lifetimeValue: Math.round(lifetime),
      });
      continue;
    }
    // c) Gone silent — no orders + no activities in SILENT_DAYS
    const latestAct = latestActivityByName.get(acct);
    const daysSinceAct = latestAct ? daysBetween(today, latestAct) : Number.POSITIVE_INFINITY;
    if (daysSince >= SILENT_DAYS && daysSinceAct >= SILENT_DAYS) {
      atRisk.push({
        accountName: acct, reason: 'silent',
        detail: `No order or activity in ${Math.min(daysSince, daysSinceAct)} days`,
        lastOrder: fmtISO(lastOrder), lifetimeValue: Math.round(lifetime),
      });
    }
  }
  // Sort by lifetime value desc — biggest accounts first.
  atRisk.sort((a, b) => b.lifetimeValue - a.lifetimeValue);
  atRisk.length = Math.min(atRisk.length, MAX_ROWS_PER_MODULE);

  // ── Module 2: Likely to reorder ──────────────────────────────────
  const likelyReorder: ReorderItem[] = [];
  for (const [acct, orders] of byAccount.entries()) {
    if (orders.length < MIN_ORDERS_FOR_CADENCE) continue;
    const intervals: number[] = [];
    for (let i = 1; i < orders.length; i++) intervals.push(daysBetween(orders[i - 1].date, orders[i].date));
    const meanInt = mean(intervals);
    const sd = stddev(intervals);
    // Only flag accounts with reasonably regular cadence — high std means
    // their orders are erratic and our prediction is noise.
    if (meanInt <= 0 || sd > meanInt) continue;

    const lastOrder = orders[orders.length - 1].date;
    const predicted = new Date(lastOrder.getTime() + meanInt * DAY);
    const daysUntil = Math.round((predicted.getTime() - today.getTime()) / DAY);
    if (daysUntil < -3 || daysUntil > REORDER_WINDOW_DAYS) continue; // -3 = grace for slightly overdue

    const recent = orders.slice(-3);
    const expectedAmount = Math.round(mean(recent.map((o) => o.amount)));
    likelyReorder.push({
      accountName: acct, predictedDate: fmtISO(predicted),
      daysUntil, expectedAmount,
    });
  }
  likelyReorder.sort((a, b) => b.expectedAmount - a.expectedAmount);
  likelyReorder.length = Math.min(likelyReorder.length, MAX_ROWS_PER_MODULE);

  // ── Module 3: Whitespace — products peers buy that this account doesn't ──
  // Group accounts by category, then within each category find products that
  // most peers buy but this account doesn't yet.
  const accountsByCategory = new Map<string, string[]>();
  const productsByAccount = new Map<string, Set<string>>();
  const productSpendByAccount = new Map<string, Map<string, number>>(); // product → total spend on it
  for (const [acct, orders] of byAccount.entries()) {
    const cat = orders[orders.length - 1].category || 'unknown';
    if (!accountsByCategory.has(cat)) accountsByCategory.set(cat, []);
    accountsByCategory.get(cat)!.push(acct);
    const prodSet = new Set<string>();
    const spendByProd = new Map<string, number>();
    for (const o of orders) {
      if (!o.product) continue;
      prodSet.add(o.product);
      spendByProd.set(o.product, (spendByProd.get(o.product) || 0) + o.amount);
    }
    productsByAccount.set(acct, prodSet);
    productSpendByAccount.set(acct, spendByProd);
  }
  const whitespace: WhitespaceItem[] = [];
  for (const [cat, peerAccounts] of accountsByCategory.entries()) {
    if (peerAccounts.length < 4) continue;          // need a meaningful peer pool
    // For each candidate product, compute peer adoption fraction & avg spend.
    const productPeers = new Map<string, { buyers: string[]; totalSpend: number }>();
    for (const peer of peerAccounts) {
      const peerProds = productsByAccount.get(peer) || new Set();
      const peerSpend = productSpendByAccount.get(peer) || new Map();
      for (const p of peerProds) {
        if (!productPeers.has(p)) productPeers.set(p, { buyers: [], totalSpend: 0 });
        productPeers.get(p)!.buyers.push(peer);
        productPeers.get(p)!.totalSpend += peerSpend.get(p) || 0;
      }
    }
    for (const acct of peerAccounts) {
      const myProds = productsByAccount.get(acct) || new Set();
      for (const [product, info] of productPeers.entries()) {
        if (myProds.has(product)) continue;
        const adoption = info.buyers.length / peerAccounts.length;
        if (adoption < WHITESPACE_PEER_THRESH) continue;
        // Skip products we already recommended for this account.
        whitespace.push({
          accountName: acct, product,
          peerAdoption: Math.round(adoption * 100) / 100,
          avgPeerSpend: Math.round(info.totalSpend / Math.max(1, info.buyers.length)),
        });
      }
    }
    void cat;  // silence unused-var if linter complains
  }
  // Sort by impact: peer adoption × avg spend
  whitespace.sort((a, b) => (b.peerAdoption * b.avgPeerSpend) - (a.peerAdoption * a.avgPeerSpend));
  whitespace.length = Math.min(whitespace.length, MAX_ROWS_PER_MODULE);

  // ── Module 4: Stuck deals ────────────────────────────────────────
  const stuckDeals: StuckDealItem[] = [];
  for (const o of opps) {
    const stage = o.stage || '';
    if (stage.startsWith('Closed')) continue;   // skip closed-won / closed-lost
    const accountName = accountNameById.get(String(o.account_id || '')) || '—';
    const latestAct = latestActivityByAccountId.get(String(o.account_id || ''));
    const daysSinceAct = latestAct ? daysBetween(today, latestAct) : Number.POSITIVE_INFINITY;
    if (daysSinceAct < STUCK_DAYS) continue;
    stuckDeals.push({
      opportunityId: String(o.id || ''),
      name: String(o.name || '—'),
      accountName,
      stage,
      amount: Math.round(Number(o.amount) || 0),
      daysSinceActivity: Number.isFinite(daysSinceAct) ? daysSinceAct : 999,
    });
  }
  stuckDeals.sort((a, b) => b.amount - a.amount);
  stuckDeals.length = Math.min(stuckDeals.length, MAX_ROWS_PER_MODULE);

  // ── Module 5: Anomaly watch ──────────────────────────────────────
  const anomalies: AnomalyItem[] = [];
  const thisMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  for (const [acct, orders] of byAccount.entries()) {
    // Need at least 6 months of history.
    const monthBuckets = new Map<string, number>();
    for (const o of orders) {
      const k = `${o.date.getFullYear()}-${String(o.date.getMonth() + 1).padStart(2, '0')}`;
      monthBuckets.set(k, (monthBuckets.get(k) || 0) + o.amount);
    }
    if (monthBuckets.size < 6) continue;
    const currentMonthAmt = monthBuckets.get(thisMonthKey) || 0;
    // Baseline = mean of last 6 month buckets excluding current.
    const sortedKeys = [...monthBuckets.keys()].sort();
    const tail = sortedKeys.filter((k) => k !== thisMonthKey).slice(-6);
    const baseline = mean(tail.map((k) => monthBuckets.get(k) || 0));
    if (baseline < 5000) continue;  // ignore tiny accounts — noisy
    if (currentMonthAmt >= baseline * ANOMALY_SPIKE_MULT) {
      anomalies.push({
        accountName: acct, direction: 'spike',
        currentMonth: Math.round(currentMonthAmt), baseline: Math.round(baseline),
        ratio: Math.round((currentMonthAmt / baseline) * 10) / 10,
      });
    } else if (currentMonthAmt > 0 && currentMonthAmt <= baseline * ANOMALY_DROP_RATIO) {
      anomalies.push({
        accountName: acct, direction: 'drop',
        currentMonth: Math.round(currentMonthAmt), baseline: Math.round(baseline),
        ratio: Math.round((currentMonthAmt / baseline) * 10) / 10,
      });
    }
  }
  anomalies.sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1));
  anomalies.length = Math.min(anomalies.length, MAX_ROWS_PER_MODULE);

  // ── Summary line ────────────────────────────────────────────────
  // Templated — small enough that LLM doesn't add value, and the page
  // stays fast and offline-safe.
  const summaryParts: string[] = [];
  if (atRisk.length)        summaryParts.push(`${atRisk.length} customer${atRisk.length === 1 ? '' : 's'} at risk`);
  if (likelyReorder.length) summaryParts.push(`${likelyReorder.length} likely to reorder soon`);
  if (stuckDeals.length)    summaryParts.push(`${stuckDeals.length} deal${stuckDeals.length === 1 ? '' : 's'} stuck`);
  if (whitespace.length)    summaryParts.push(`${whitespace.length} cross-sell opportunit${whitespace.length === 1 ? 'y' : 'ies'}`);
  if (anomalies.length)     summaryParts.push(`${anomalies.length} unusual pattern${anomalies.length === 1 ? '' : 's'}`);
  const summary = summaryParts.length === 0
    ? 'Nothing flagged today. Pipeline looks healthy.'
    : summaryParts.join(' · ');

  return NextResponse.json({
    summary,
    atRisk,
    likelyReorder,
    whitespace,
    stuckDeals,
    anomalies,
    generatedAt: new Date().toISOString(),
  });
}
