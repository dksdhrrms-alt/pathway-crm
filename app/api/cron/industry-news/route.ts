/**
 * GET /api/cron/industry-news
 *
 * Daily 6am CT (= 12:00 UTC) cron — picks the day's top 2 industry
 * headlines for the home dashboard's Industry News card.
 *
 * Flow:
 *   1. Fetch all RSS feeds in lib/news.RSS_SOURCES.
 *   2. Keep items published within the last 24h.
 *   3. If we got <8 items, widen to 7 days so weekends/holidays
 *      don't leave us with nothing.
 *   4. Send the candidates to Claude with a prompt that explicitly
 *      asks for "would a US feed-additive sales rep care?" filtering.
 *   5. Insert the top 2 (rank 1, 2) with surface_date = today.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel cron sends).
 *
 * Notes:
 *   - Idempotent on a given day via (surface_date) — re-running the
 *     cron the same day deletes prior rows and re-inserts. That lets
 *     us safely re-trigger manually if something looked off.
 *   - Anthropic call uses Haiku-class for cost; a single run is well
 *     under $0.05.
 */
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { RSS_SOURCES } from '@/lib/news';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RssEntry {
  title: string;
  link: string;
  publishedAt: string | null;
  description: string;
  sourceName: string;
}

/** Minimal RSS parser — handles RSS 2.0 and basic Atom. */
function parseRss(xml: string, sourceName: string): RssEntry[] {
  const items: RssEntry[] = [];
  // RSS <item>...</item>
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRe) || [];
  for (const block of matches) {
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pub = extractTag(block, 'pubDate') || extractTag(block, 'dc:date');
    const desc = extractTag(block, 'description') || extractTag(block, 'content:encoded');
    if (!title || !link) continue;
    const publishedAt = pub ? new Date(pub).toISOString() : null;
    items.push({
      title: stripTags(title).slice(0, 240),
      link: link.trim(),
      publishedAt,
      description: stripTags(desc).slice(0, 800),
      sourceName,
    });
  }
  // Atom <entry>...</entry>
  if (items.length === 0) {
    const entryRe = /<entry\b[\s\S]*?<\/entry>/gi;
    const ms = xml.match(entryRe) || [];
    for (const block of ms) {
      const title = extractTag(block, 'title');
      const linkAttr = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      const link = linkAttr ? linkAttr[1] : '';
      const pub = extractTag(block, 'updated') || extractTag(block, 'published');
      const desc = extractTag(block, 'summary') || extractTag(block, 'content');
      if (!title || !link) continue;
      const publishedAt = pub ? new Date(pub).toISOString() : null;
      items.push({
        title: stripTags(title).slice(0, 240),
        link: link.trim(),
        publishedAt,
        description: stripTags(desc).slice(0, 800),
        sourceName,
      });
    }
  }
  return items;
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

async function fetchOneFeed(src: { name: string; url: string }): Promise<RssEntry[]> {
  try {
    const res = await fetch(src.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[news] ${src.name} HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    return parseRss(xml, src.name);
  } catch (err) {
    console.warn(`[news] ${src.name} fetch failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

interface ClaudePick {
  index: number;
  title: string;
  summary: string;
  why_it_matters: string;
  category: string;
}

async function curateWithClaude(entries: RssEntry[]): Promise<ClaudePick[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[news] ANTHROPIC_API_KEY not set — falling back to top 2 by recency');
    return entries.slice(0, 2).map((e, i) => ({
      index: i,
      title: e.title,
      summary: e.description.slice(0, 240),
      why_it_matters: 'AI curation unavailable — most recent items shown.',
      category: 'Market',
    }));
  }

  const compact = entries.map((e, i) => ({
    index: i,
    title: e.title,
    source: e.sourceName,
    published: e.publishedAt,
    snippet: e.description.slice(0, 400),
  }));

  const prompt = `You are curating the home dashboard for Pathway Intermediates USA, a feed additive company selling to US livestock producers (poultry, swine, dairy, beef, aquaculture).

From the following ${compact.length} articles, pick the TOP 2 that are MOST useful for a feed additive sales rep — meaning the news directly affects:
  - Animal disease / biosecurity (creates demand for immune/health additives)
  - Feed ingredient prices or supply (affects customer cost pressure)
  - Regulatory changes (antibiotic, additive, label rules — opens new product categories)
  - Major US customer companies (Tyson, Cargill, JBS, Smithfield, Perdue, Pilgrim's, Hormel, Land O'Lakes, Mountaire, Sanderson, Wayne-Sanderson, etc.) — expansions, M&A, earnings
  - Performance/nutrition technology that affects how reps position our products

EXCLUDE: pure consumer food trends, restaurant news, recipes, opinion pieces, vague macro stories without livestock/feed connection, anything older than 7 days where a fresher equivalent exists.

For each pick, write:
  - title: keep the original (under 120 chars)
  - summary: 1-2 sentences in plain English explaining what happened
  - why_it_matters: 1 sentence explaining the sales-rep angle ("Customer X may need more of our Y because Z")
  - category: one of Disease, Regulatory, Market, Customer, Technology

Articles:
${JSON.stringify(compact, null, 2)}

Return ONLY valid JSON in this shape, no other text:
{ "picks": [ { "index": 0, "title": "...", "summary": "...", "why_it_matters": "...", "category": "Market" }, ... ] }`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[news] Claude error', res.status, errBody.slice(0, 300));
    return entries.slice(0, 2).map((e, i) => ({
      index: i, title: e.title, summary: e.description.slice(0, 240),
      why_it_matters: 'AI fallback — manual curation suggested.', category: 'Market',
    }));
  }
  const data = await res.json() as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text ?? '';
  try {
    // Extract first JSON object in case Claude added prose around it.
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { picks: ClaudePick[] };
    return (parsed.picks || []).slice(0, 2);
  } catch (err) {
    console.error('[news] Claude JSON parse failed:', err instanceof Error ? err.message : err);
    return [];
  }
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

  const today = new Date().toISOString().split('T')[0];

  // 1. Fetch all feeds in parallel.
  const allEntries: RssEntry[] = (
    await Promise.all(RSS_SOURCES.map((s) => fetchOneFeed(s)))
  ).flat();

  if (allEntries.length === 0) {
    // Graceful: 200 + ok:false so Vercel doesn't mark the cron as a
    // hard failure and the bell stops flooding. Logs still show which
    // feeds returned what status (logged inside fetchOneFeed).
    return Response.json({ ok: false, error: 'all RSS feeds empty' });
  }

  // 2. Filter to last 24h; widen to 7 days if too few.
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const within = (cutoffMs: number) => allEntries.filter((e) =>
    e.publishedAt && (now - new Date(e.publishedAt).getTime()) <= cutoffMs,
  );
  let pool = within(1 * day);
  let windowUsed: '24h' | '7d' = '24h';
  if (pool.length < 8) {
    pool = within(7 * day);
    windowUsed = '7d';
  }
  if (pool.length === 0) {
    // Last resort — most recent overall.
    pool = [...allEntries]
      .sort((a, b) => (new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()))
      .slice(0, 20);
  }

  // Dedupe by URL.
  const seen = new Set<string>();
  pool = pool.filter((e) => {
    const k = e.link.replace(/[#?].*$/, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 30);

  // 3. Ask Claude to pick the top 2.
  const picks = await curateWithClaude(pool);
  if (picks.length === 0) {
    return Response.json({ ok: false, error: 'no picks returned', pool_size: pool.length }, { status: 500 });
  }

  // 4. Clear today's rows then insert fresh.
  await sb.from('industry_news').delete().eq('surface_date', today);

  interface NewsRow {
    id: string;
    surface_date: string;
    title: string;
    summary: string;
    why_it_matters: string;
    category: string;
    source_url: string;
    source_name: string;
    published_at: string | null;
    rank: number;
  }
  const rows: NewsRow[] = [];
  let rank = 1;
  for (const p of picks) {
    const src = pool[p.index];
    if (!src) continue;
    const id = `news-${today}-${rank}`;
    rows.push({
      id,
      surface_date: today,
      title: p.title.slice(0, 240),
      summary: p.summary.slice(0, 600),
      why_it_matters: (p.why_it_matters || '').slice(0, 240),
      category: p.category,
      source_url: src.link,
      source_name: src.sourceName,
      published_at: src.publishedAt,
      rank,
    });
    rank++;
    if (rank > 2) break;
  }

  const { error: insErr } = await sb.from('industry_news').insert(rows);
  if (insErr) {
    return Response.json({ ok: false, error: insErr.message, attempted: rows.length }, { status: 500 });
  }

  return Response.json({
    ok: true,
    surface_date: today,
    window: windowUsed,
    pool_size: pool.length,
    picks: rows.map((r) => ({ rank: r.rank, title: r.title, source: r.source_name })),
  });
}
