/**
 * GET /api/dev-tools/usda-probe?slug=<slug_id>
 *
 * One-shot diagnostic for the USDA MyMarketNews (MARS) API. Used to
 * inspect the JSON shape of a specific report before wiring it into
 * the commodity-prices cron. Delete this file after the integration
 * is finalized.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 * Env: `USDA_MMN_API_KEY` — Basic auth, `${key}:` base64-encoded.
 *
 * Example slugs:
 *   3618 — National Weekly Grain Co-Products Report (DDGS)
 *   3510 — National Animal By-Product Feedstuff Report (CWG)
 */
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.USDA_MMN_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'USDA_MMN_API_KEY not set' }, { status: 500 });
  }

  const slug = request.nextUrl.searchParams.get('slug') || '3618';
  // Default call returns only the "Report Header" section (metadata
  // about each weekly issue, no prices). Real price rows live in the
  // "Report Detail" section — pass `?section=Report Detail`.
  const section = request.nextUrl.searchParams.get('section');
  const base = `https://marsapi.ams.usda.gov/services/v1.1/reports/${encodeURIComponent(slug)}`;
  const url = section ? `${base}/${encodeURIComponent(section)}` : base;
  const basic = Buffer.from(`${apiKey}:`).toString('base64');

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return Response.json({
      ok: false,
      slug,
      url,
      fetch_error: err instanceof Error ? err.message : String(err),
    });
  }

  const ct = res.headers.get('content-type') || '';
  const bodyText = await res.text();
  let json: unknown = null;
  let parseError: string | null = null;
  if (ct.includes('json')) {
    try { json = JSON.parse(bodyText); }
    catch (err) { parseError = err instanceof Error ? err.message : String(err); }
  }

  return Response.json({
    ok: res.ok,
    slug,
    status: res.status,
    content_type: ct,
    parse_error: parseError,
    // If JSON parsed, return it as-is so we can see the shape.
    // If not (HTML error page, plain text), return the first 2000 chars.
    body: json ?? bodyText.slice(0, 2000),
  });
}
