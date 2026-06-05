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
 * RSS feeds we poll each morning. All publicly accessible, no auth.
 * Reordering only affects tie-breakers; Claude scores relevance first.
 */
export const RSS_SOURCES: RssSource[] = [
  { name: 'WattAgNet',     url: 'https://www.wattagnet.com/rss.xml',      weight: 1.0 },
  { name: 'Pork Business', url: 'https://www.porkbusiness.com/rss.xml',   weight: 1.0 },
  { name: 'Drovers',       url: 'https://www.drovers.com/rss.xml',        weight: 1.0 },
  { name: 'Feedstuffs',    url: 'https://www.feedstuffs.com/rss',         weight: 1.1 },
  { name: 'AllAboutFeed',  url: 'https://www.allaboutfeed.net/feed/',     weight: 1.0 },
  { name: 'The Poultry Site', url: 'https://www.thepoultrysite.com/rss/news', weight: 0.9 },
  { name: 'Pig Progress',  url: 'https://www.pigprogress.net/feed/',      weight: 0.9 },
];

/** Format a UTC ISO string → 'Jun 4, 9:31 AM' for the card. */
export function fmtNewsTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
