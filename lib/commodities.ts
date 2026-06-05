/**
 * Today's Market — commodity tracking config + helpers.
 *
 * Five feed inputs we surface on the home dashboard. Three trade as
 * CBOT futures (fetched from Yahoo Finance daily); two are USDA AMS
 * cash references (scraped weekly from the public text reports).
 */

export type CommodityKey =
  | 'soybean_oil'
  | 'corn'
  | 'soybean_meal'
  | 'ddgs'
  | 'choice_white_grease';

export interface CommodityConfig {
  key: CommodityKey;
  label: string;
  unit: string;
  /** 'cbot' = Yahoo Finance futures contract; 'usda-ams' = USDA scrape. */
  source: 'cbot' | 'usda-ams';
  /** Yahoo Finance symbol for CBOT futures (continuous front month). */
  yahooSymbol?: string;
  /** USDA AMS report identifier for cash-market commodities. */
  usdaReport?: string;
  /** Short descriptor used in the dashboard tooltip. */
  description: string;
}

export const COMMODITIES: CommodityConfig[] = [
  {
    key: 'soybean_oil',
    label: 'Soybean Oil',
    unit: 'cents/lb',
    source: 'cbot',
    yahooSymbol: 'ZL=F',
    description: 'CBOT front-month Soybean Oil futures.',
  },
  {
    key: 'corn',
    label: 'Corn',
    unit: 'USD/bu',
    source: 'cbot',
    yahooSymbol: 'ZC=F',
    description: 'CBOT front-month Corn futures.',
  },
  {
    key: 'soybean_meal',
    label: 'Soybean Meal',
    unit: 'USD/ton',
    source: 'cbot',
    yahooSymbol: 'ZM=F',
    description: 'CBOT front-month Soybean Meal futures (48% protein).',
  },
  {
    key: 'ddgs',
    label: 'DDGS (Iowa)',
    unit: 'USD/ton',
    source: 'usda-ams',
    usdaReport: 'sj_gr852',
    description: 'USDA AMS — Iowa Distillers Dried Grains (weekly cash).',
  },
  {
    key: 'choice_white_grease',
    label: 'Choice White Grease',
    unit: 'cents/lb',
    source: 'usda-ams',
    usdaReport: 'wa_ls441',
    description: 'USDA AMS — National Weekly Choice White Grease.',
  },
];

export interface PriceRow {
  commodityKey: CommodityKey;
  date: string;          // YYYY-MM-DD
  price: number;
  unit: string;
  source: string;
}

export interface CommodityCardEntry {
  config: CommodityConfig;
  latest: PriceRow | null;
  previous: PriceRow | null;       // closest prior trading day (for daily Δ)
  yearAgo: PriceRow | null;        // closest entry to one-year-ago (for YoY Δ)
  asOfNote?: string;               // 'as of May 30' for stale weekly cash references
}

/** Format YYYY-MM-DD → 'May 30' */
export function fmtShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Compute %Δ. Returns null when prior <= 0 or missing. */
export function pctDelta(latest: number | null | undefined, prior: number | null | undefined): number | null {
  if (latest == null || prior == null || prior === 0) return null;
  return ((latest - prior) / prior) * 100;
}

/** Format price with right precision per unit. */
export function fmtPrice(value: number, unit: string): string {
  if (unit === 'cents/lb') return value.toFixed(2);
  if (unit === 'USD/bu') return value.toFixed(2);
  return Math.round(value).toLocaleString('en-US');
}

/** Format % Δ with sign, arrow, and one decimal. */
export function fmtDelta(pct: number | null): { text: string; tone: 'up' | 'down' | 'flat' | 'na' } {
  if (pct == null) return { text: '—', tone: 'na' };
  if (Math.abs(pct) < 0.05) return { text: 'flat', tone: 'flat' };
  const sign = pct > 0 ? '+' : '';
  return {
    text: `${pct > 0 ? '▲' : '▼'} ${sign}${pct.toFixed(1)}%`,
    tone: pct > 0 ? 'up' : 'down',
  };
}
