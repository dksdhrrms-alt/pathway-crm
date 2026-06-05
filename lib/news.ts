/**
 * Industry News — types + RSS sources for the daily curation cron.
 */

export interface NewsItem {
  /** Stable id derived from URL — used as primary key. */
  id: string;
  surfaceDate: string;          // YYYY-MM-DD
  title: string;
  summary: string;
  whyItMatters?: string | null;
  category?: string | null;
  sourceUrl: string;
  sourceName?: string | null;
  publishedAt?: string | null;
  rank: number;                 // 1 or 2
}

export interface RssSource {
  name: string;
  url: string;
  /** Optional weight when ranking — higher = preferred when scores tie. */
  weight?: number;
}

/**
 * RSS feeds we poll each morning.
 *
 * We use Google News RSS search instead of polling industry sites
 * directly: Vercel data-center IPs got increasingly blocked (Cloudflare
 * 403s) and several publishers retired their public RSS endpoints
 * (404s). Google News aggregates the same publishers, doesn't block,
 * and returns a clean RSS 2.0 feed. The `<source>` element inside each
 * item still carries the real publisher name.
 *
 * Buckets chosen to cover Pathway's customer base — feed additive
 * (core), poultry, swine, cattle/dairy. Claude scores cross-bucket
 * relevance, so weight ties only matter when scores are equal.
 */
const GNEWS = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

export const RSS_SOURCES: RssSource[] = [
  { name: 'Feed Additive', url: GNEWS('"feed additive" OR "animal nutrition" OR "livestock feed"'), weight: 1.2 },
  { name: 'Poultry',       url: GNEWS('poultry industry OR broiler OR "chicken production"'),       weight: 1.0 },
  { name: 'Swine',         url: GNEWS('pork industry OR swine OR "hog production"'),                weight: 1.0 },
  { name: 'Cattle/Dairy',  url: GNEWS('dairy industry OR "beef production" OR "cattle ranching"'),  weight: 1.0 },
];

/** Format a UTC ISO string → 'Jun 4, 9:31 AM' for the card. */
export function fmtNewsTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
