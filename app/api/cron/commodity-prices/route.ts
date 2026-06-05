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
 * USDA AMS text report parser. The reports at
 *   https://www.ams.usda.gov/mnreports/<reportid>.txt
 * are plain text with a header line carrying the report date and a
 * table of locations + price ranges further down. Without a stable
 * JSON API this is the most reliable public source.
 *
 * For DDGS Iowa (sj_gr852) we average the high/low of the "Iowa
 * Plant Origin" line. For Choice White Grease (wa_ls441) we take the
 * "Choice White Grease" line's mid.
 *
 * If the report can't be parsed we return ok:false so the row isn't
 * overwritten and the dashboard keeps the last good price.
 */
async function fetchUsdaText(reportId: string, parser: (txt: string) => FetchResult): Promise<FetchResult> {
  try {
    const url = `https://www.ams.usda.gov/mnreports/${reportId}.txt`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 PathwayCRM/1.0', Accept: 'text/plain' },
    });
    if (!res.ok) return { ok: false, error: `usda ${res.status}` };
    const txt = await res.text();
    return parser(txt);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Extract a date from the USDA header. They use formats like
 *   "May 30, 2026"
 *   "5/30/2026"
 * Fallback: today's date if we can't find one.
 */
function extractReportDate(txt: string): string {
  const longRe = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i;
  const m = txt.match(longRe);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  const shortRe = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
  const ms = txt.match(shortRe);
  if (ms) {
    const d = new Date(`${ms[3]}-${ms[1].padStart(2, '0')}-${ms[2].padStart(2, '0')}T00:00:00`);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

/**
 * DDGS Iowa parser — looks for the first numeric range on a line that
 * mentions "Iowa" or "DDG" and takes its midpoint as USD/ton.
 */
function parseDdgs(txt: string): FetchResult {
  const date = extractReportDate(txt);
  const lines = txt.split('\n');
  // Pattern: anything → "200.00-220.00" or "200-220" toward end of line
  const rangeRe = /(\d{2,4}(?:\.\d{1,2})?)\s*-\s*(\d{2,4}(?:\.\d{1,2})?)/;
  for (const raw of lines) {
    const line = raw.toLowerCase();
    if (!/iowa|ddg|distillers/.test(line)) continue;
    const m = raw.match(rangeRe);
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (!isFinite(lo) || !isFinite(hi) || lo <= 0 || hi <= 0) continue;
    const mid = (lo + hi) / 2;
    if (mid < 50 || mid > 800) continue;  // sanity bound for USD/ton
    return { ok: true, points: [{ date, price: mid }] };
  }
  return { ok: false, error: 'no-iowa-ddgs-line' };
}

/**
 * Choice White Grease parser — finds the line mentioning "Choice
 * White Grease" and pulls its price (cents/lb). Reports sometimes
 * quote a range, sometimes a single number.
 */
function parseChoiceWhiteGrease(txt: string): FetchResult {
  const date = extractReportDate(txt);
  const lines = txt.split('\n');
  for (const raw of lines) {
    if (!/choice\s+white\s+grease/i.test(raw)) continue;
    const range = raw.match(/(\d{1,3}(?:\.\d{1,3})?)\s*-\s*(\d{1,3}(?:\.\d{1,3})?)/);
    if (range) {
      const mid = (Number(range[1]) + Number(range[2])) / 2;
      if (mid > 5 && mid < 200) return { ok: true, points: [{ date, price: mid }] };
    }
    const single = raw.match(/(\d{1,3}\.\d{1,3})/);
    if (single) {
      const v = Number(single[1]);
      if (v > 5 && v < 200) return { ok: true, points: [{ date, price: v }] };
    }
  }
  return { ok: false, error: 'no-cwg-line' };
}

async function fetchOne(c: CommodityConfig): Promise<FetchResult> {
  if (c.source === 'cbot' && c.yahooSymbol) return fetchYahoo(c.yahooSymbol);
  if (c.source === 'usda-ams' && c.usdaReport) {
    if (c.key === 'ddgs') return fetchUsdaText(c.usdaReport, parseDdgs);
    if (c.key === 'choice_white_grease') return fetchUsdaText(c.usdaReport, parseChoiceWhiteGrease);
  }
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
      const last = r.points[r.points.length - 1];
      results.push({
        key: c.key, status: 'ok',
        detail: `${rows.length} rows up to ${last.date} (${last.price})`,
      });
    }
  }

  return Response.json({
    ok: results.every((r) => r.status !== 'failed'),
    results,
  });
}
