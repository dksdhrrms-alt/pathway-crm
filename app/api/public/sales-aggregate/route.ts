/**
 * GET /api/public/sales-aggregate  — read-only, server-to-server
 *
 * Eric's management dashboard aggregates revenue across the Pathway
 * + BioMatrix CRMs. This endpoint returns a structured breakdown of
 * sale_records by date × team × category, split into two buckets:
 *
 *   · invoiced_sales : rows where date <= today (已발행된 확정 매출)
 *   · open_po        : rows where date  > today (예정된 미인보이스 PO)
 *
 * The `date` field is the proxy for invoice status — `payment_status`
 * in the DB is free-text and unreliable (mostly blank, some literal
 * date strings, some "Completed"), so we deliberately don't lean on
 * it. Confirmed with Eric on 2026-11-19.
 *
 * Auth:  Authorization: Bearer <SALES_API_KEY>
 *        The key is set as the SALES_API_KEY env var in Vercel and
 *        never checked into the repo. Rotate by changing the env var
 *        and re-issuing to the dashboard.
 *
 * Cache: Dashboard side polls and caches for 5 min. Our response
 *        includes Cache-Control + `as_of` timestamp so the dashboard
 *        can detect staleness (it falls back to the last-good value
 *        on failure).
 *
 * Query params (all optional):
 *   from=YYYY-MM-DD    inclusive lower bound on date (default 2020-01-01)
 *   to=YYYY-MM-DD      inclusive upper bound on date (default today + 2y)
 *   team=<text>        filter to exactly one team (case-insensitive)
 *   category=<text>    filter to exactly one category (case-insensitive)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 20;

/** Hard-coded company label so Eric's dashboard can tell the two
 *  responses apart without inspecting the URL. */
const COMPANY = 'pathway-usa';
const CURRENCY = 'USD';

interface AggregateRow {
  date: string;        // YYYY-MM-DD
  team: string | null;
  category: string | null;
  amount: number;
}

interface ApiResponse {
  company: string;
  currency: string;
  as_of: string;
  filters: { from: string; to: string; team: string | null; category: string | null };
  invoiced_sales: AggregateRow[];
  open_po: AggregateRow[];
  totals: { invoiced: number; open_po: number; row_count_invoiced: number; row_count_po: number };
}

function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function plusYearsISO(n: number): string {
  const d = new Date(); d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
}
function validISODate(s: string | null): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────
  const expected = process.env.SALES_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'SALES_API_KEY not configured on server' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Params ────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const fromRaw = searchParams.get('from');
  const toRaw = searchParams.get('to');
  const teamFilter = searchParams.get('team');
  const categoryFilter = searchParams.get('category');

  if (fromRaw && !validISODate(fromRaw)) {
    return NextResponse.json({ error: 'from must be YYYY-MM-DD' }, { status: 400 });
  }
  if (toRaw && !validISODate(toRaw)) {
    return NextResponse.json({ error: 'to must be YYYY-MM-DD' }, { status: 400 });
  }

  const from = fromRaw || '2020-01-01';
  const to   = toRaw   || plusYearsISO(2);

  // ── Supabase ──────────────────────────────────────────────
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Pull the raw rows we'll aggregate. We only need four columns.
  // Range filter with gte/lte here instead of post-filtering because
  // sale_records is small (~1,500 rows) today but can grow.
  let q = sb.from('sale_records').select('date, team, category, amount')
    .gte('date', from).lte('date', to)
    .not('date', 'is', null).neq('date', '')
    .not('amount', 'is', null);
  if (teamFilter)     q = q.ilike('team', teamFilter);
  if (categoryFilter) q = q.ilike('category', categoryFilter);
  // Hard cap — upper bound for safety; 50k rows is well over the
  // size we expect for any sensible from/to window.
  q = q.limit(50_000);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: `supabase: ${error.message}` }, { status: 500 });
  }

  // ── Aggregate in memory: date × team × category ───────────
  // (Doing this server-side keeps the response tiny and lets the
  // dashboard skip any reduce logic — Eric's spec was pre-aggregated
  // rows.)
  const today = todayISO();
  type BucketMap = Map<string, AggregateRow>;
  const invoicedMap: BucketMap = new Map();
  const poMap: BucketMap = new Map();
  let totalInvoiced = 0;
  let totalPo = 0;

  for (const r of (data ?? []) as Array<{ date: string; team: string | null; category: string | null; amount: number | string }>) {
    const dateStr = typeof r.date === 'string' ? r.date.slice(0, 10) : '';
    if (!validISODate(dateStr)) continue;
    const amt = Number(r.amount) || 0;
    if (amt === 0) continue;
    const team = r.team && r.team.trim() !== '' ? r.team : null;
    const category = r.category && r.category.trim() !== '' ? r.category : null;
    const key = `${dateStr}|${team ?? ''}|${category ?? ''}`;
    const map = dateStr <= today ? invoicedMap : poMap;
    const existing = map.get(key);
    if (existing) existing.amount += amt;
    else map.set(key, { date: dateStr, team, category, amount: amt });
    if (dateStr <= today) totalInvoiced += amt; else totalPo += amt;
  }

  const sortRows = (rows: AggregateRow[]) => rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const at = a.team ?? ''; const bt = b.team ?? '';
    if (at !== bt) return at.localeCompare(bt);
    return (a.category ?? '').localeCompare(b.category ?? '');
  });

  // Round to 2 decimal places to avoid float noise (0.1 + 0.2 = …).
  const round2 = (rows: AggregateRow[]) => rows.map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 }));

  const invoiced_sales = round2(sortRows(Array.from(invoicedMap.values())));
  const open_po       = round2(sortRows(Array.from(poMap.values())));

  const payload: ApiResponse = {
    company: COMPANY,
    currency: CURRENCY,
    as_of: new Date().toISOString(),
    filters: { from, to, team: teamFilter, category: categoryFilter },
    invoiced_sales,
    open_po,
    totals: {
      invoiced: Math.round(totalInvoiced * 100) / 100,
      open_po:  Math.round(totalPo * 100) / 100,
      row_count_invoiced: invoiced_sales.length,
      row_count_po:       open_po.length,
    },
  };

  return NextResponse.json(payload, {
    headers: {
      // Dashboard side is expected to cache for 5 min on its own; this
      // header is an upstream hint for CDN / edge caches in case a
      // layer in between also caches. `private` so no shared cache
      // holds it, since the response is keyed to the API caller.
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  });
}
