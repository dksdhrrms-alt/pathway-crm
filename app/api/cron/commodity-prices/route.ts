/**
 * GET /api/cron/commodity-prices
 *
 * Daily cron — fetches the 5 feed-input prices powering the
 * Today's Market home card.
 *
 * Schedule (vercel.json): `0 22 * * 1-5`  → 22:00 UTC weekdays
 *   ≈ 5pm CDT / 4pm CST — runs after CBOT close (1:20pm CT).
 *
 * Sources:
 *   • CBOT futures (ZL=F, ZC=F, ZM=F) — Yahoo Finance public chart API
 *   • USDA AMS DDGS (Iowa) — sj_gr852 weekly text report
 *   • USDA AMS Choice White Grease — wa_ls441 weekly text report
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel cron sends it).
 *
 * Behavior:
 *   - Each commodity is fetched independently; one failure doesn't
 *     break the rest. Per-row results are returned in the response so
 *     Vercel logs surface what worked and what didn't.
 *   - Upsert by (commodity_key, date) — re-runs on the same day are
 *     idempotent and refresh the latest cached price.
 *   - USDA cash reports update only on certain weekdays; on other
 *     days the scraper returns the same date+price → upsert skips.
 */
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { COMMODITIES, type CommodityConfig } from '@/lib/commodities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface PricePoint { date: string; price: number }
interface FetchOk { ok: true; points: PricePoint[] }
interface FetchErr { ok: false; error: string }
type FetchResult = FetchOk | FetchErr;

/**
 * Yahoo Finance chart API. Public, no auth. We pull a 30-day window
 * and return EVERY non-null close — upserting all of them means a
 * first-run on a fresh DB instantly seeds enough history for the
 * widget to display a price even before today's close lands.
 */
async function fetchYahoo(symbol: string): Promise<FetchResult> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 PathwayCRM/1.0' },
    });
    if (!res.ok) return { ok: false, error: `yahoo ${res.status}` };
    const data = await res.json() as {
      chart?: { result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: (number | null)[] }> };
      }> };
    };
    const r = data.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const closes = r?.indicators?.quote?.[0]?.close ?? [];
    const points: PricePoint[] = [];
    for (let i = 0; i < closes.length; i++) {
      const c = closes[i];
      const t = ts[i];
      if (c != null && t != null) {
        points.push({
          date: new Date(t * 1000).toISOString().split('T')[0],
          price: Number(c),
        });
      }
    }
    if (points.length === 0) return { ok: false, error: 'no-close-in-window' };
    return { ok: true, points };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * USDA MyMarketNews (MARS) JSON API. We fetch the "Report Detail"
 * section of each report (Header has metadata only), filter rows by
 * the config's mmnFilter, group by report_date, and return the latest
 * date's price — averaged across regions when the report covers
 * multiple locations (CWG).
 */
async function fetchMmn(c: CommodityConfig): Promise<FetchResult> {
  const apiKey = process.env.USDA_MMN_API_KEY;
  if (!apiKey) return { ok: false, error: 'no-mmn-api-key' };
  if (!c.mmnSlug || !c.mmnPriceField) return { ok: false, error: 'no-mmn-config' };
  try {
    const url = `https://marsapi.ams.usda.gov/services/v1.2/reports/${encodeURIComponent(c.mmnSlug)}/${encodeURIComponent('Report Detail')}`;
    const basic = Buffer.from(`${apiKey}:`).toString('base64');
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, error: `mmn ${res.status}` };
    const data = await res.json() as {
      results?: Array<Record<string, unknown>>;
    };
    const rows = data.results || [];
    const f = c.mmnFilter || {};
    const matching = rows.filter((r) => {
      if (f.commodity && r.commodity !== f.commodity) return false;
      if (f.trade_loc && r.trade_loc !== f.trade_loc) return false;
      if (f.variety && r.variety !== f.variety) return false;
      return true;
    });
    if (matching.length === 0) return { ok: false, error: 'no-matching-rows' };
    // Group by report_date (MM/dd/yyyy), pick the most recent.
    const byDate = new Map<string, number[]>();
    for (const r of matching) {
      const rd = String(r.report_date || '');
      const p = Number(r[c.mmnPriceField]);
      if (!rd || !isFinite(p)) continue;
      const arr = byDate.get(rd) ?? [];
      arr.push(p);
      byDate.set(rd, arr);
    }
    if (byDate.size === 0) return { ok: false, error: 'no-priced-rows' };
    // Sort dates descending. report_date format is MM/dd/yyyy.
    const dates = [...byDate.keys()].sort((a, b) => mmddyyyyToTime(b) - mmddyyyyToTime(a));
    const points: PricePoint[] = [];
    for (const rd of dates.slice(0, 26)) {  // keep ~6 months of weekly history
      const prices = byDate.get(rd) || [];
      if (prices.length === 0) continue;
      const avg = prices.reduce((s, v) => s + v, 0) / prices.length;
      points.push({ date: mmddyyyyToIso(rd), price: avg });
    }
    if (points.length === 0) return { ok: false, error: 'no-points' };
    return { ok: true, points };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** "06/01/2026" → "2026-06-01" */
function mmddyyyyToIso(s: string): string {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return s;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Comparable timestamp from MM/dd/yyyy (0 if unparseable). */
function mmddyyyyToTime(s: string): number {
  const iso = mmddyyyyToIso(s);
  const t = new Date(`${iso}T00:00:00Z`).getTime();
  return isFinite(t) ? t : 0;
}

async function fetchOne(c: CommodityConfig): Promise<FetchResult> {
  if (c.source === 'cbot' && c.yahooSymbol) return fetchYahoo(c.yahooSymbol);
  if (c.source === 'usda-ams' && c.mmnSlug) return fetchMmn(c);
  return { ok: false, error: 'no-fetcher' };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!sbUrl || !sbKey) return Response.json({ error: 'No Supabase config' }, { status: 500 });
  const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

  const results: Array<{ key: string; status: 'ok' | 'failed' | 'skipped'; detail?: string }> = [];

  for (const c of COMMODITIES) {
    const r = await fetchOne(c);
    if (!r.ok) {
      results.push({ key: c.key, status: 'failed', detail: r.error });
      continue;
    }
    // Upsert every point Yahoo / USDA gave us. Yahoo returns the
    // last 30 days in one shot, so a first-ever run instantly
    // backfills history and the widget can display yesterday's
    // close before today's CBOT settlement even lands.
    const rows = r.points.map((p) => ({
      id: `cp-${c.key}-${p.date}`,
      commodity_key: c.key,
      date: p.date,
      price: p.price,
      unit: c.unit,
      source: c.source,
    }));
    const { error } = await sb.from('commodity_prices').upsert(rows, {
      onConflict: 'commodity_key,date',
    });
    if (error) {
      results.push({ key: c.key, status: 'failed', detail: error.message });
    } else {
      // Find the newest point regardless of source ordering — Yahoo
      // returns chronological, MMN returns reverse-chronological. Min/
      // max scan is cheap (≤ ~30 points) and robust to either shape.
      const newest = r.points.reduce((a, b) => (a.date > b.date ? a : b));
      const oldest = r.points.reduce((a, b) => (a.date < b.date ? a : b));
      results.push({
        key: c.key, status: 'ok',
        detail: `${rows.length} rows ${oldest.date}..${newest.date} (latest=${newest.price})`,
      });
    }
  }

  return Response.json({
    ok: results.every((r) => r.status !== 'failed'),
    results,
  });
}
