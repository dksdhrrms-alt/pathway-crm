/**
 * Today's Market — commodity tracking config + helpers.
 *
 * Five feed inputs we surface on the home dashboard. Three trade as
 * CBOT futures (fetched from Yahoo Finance daily); two are USDA AMS
 * cash references read from the MyMarketNews JSON API (the old plain-
 * text reports were retired by USDA in 2025).
 */

export type CommodityKey =
  // Feed inputs (original 5)
  | 'soybean_oil'
  | 'corn'
  | 'soybean_meal'
  | 'ddgs'
  | 'choice_white_grease'
  // Poultry & egg protein watch (added 2026-10)
  | 'bs_breast'
  | 'turkey_whole_hen'
  | 'shell_eggs_layer'
  // Red meat & dairy watch (added 2026-10)
  | 'lean_hogs'
  | 'live_cattle'
  | 'class_iii_milk'
  | 'class_iv_milk';

/** Filter conditions matched against rows in the MMN Report Detail. */
/** Field → exact value. Any MMN Report Detail column can be used
 *  (e.g. `item`, `class`, `condition` on the poultry reports). */
export type MmnFilter = Record<string, string>;

export interface CommodityConfig {
  key: CommodityKey;
  label: string;
  unit: string;
  /** 'cbot' = Yahoo Finance futures contract; 'usda-ams' = USDA MMN. */
  source: 'cbot' | 'usda-ams';
  /** Yahoo Finance symbol for CBOT futures (continuous front month). */
  yahooSymbol?: string;
  /** USDA MyMarketNews slug_id (e.g. '3618' for DDGS). */
  mmnSlug?: string;
  /** Row filter applied to the MMN Report Detail rows. */
  mmnFilter?: MmnFilter;
  /** Which numeric field on a matching row is the price. */
  mmnPriceField?: string;
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
    mmnSlug: '3618',
    mmnFilter: { commodity: 'Distillers Grain', trade_loc: 'Iowa', variety: 'Dried 10%' },
    mmnPriceField: 'price',
    description: 'USDA AMS — Iowa Dried DDGS (10% moisture, weekly cash).',
  },
  {
    key: 'choice_white_grease',
    label: 'Choice White Grease',
    unit: 'cents/lb',
    source: 'usda-ams',
    mmnSlug: '3510',
    mmnFilter: { commodity: 'Choice White Grease' },
    // Report covers multiple locations on the same date; the cron
    // averages avg_price across all matching rows of the latest date.
    mmnPriceField: 'avg_price',
    description: 'USDA AMS — National Weekly Choice White Grease (avg across regions).',
  },

  // ── Poultry & egg price watch ──────────────────────────────────
  // All three are USDA AMS cash references (no futures market exists).
  // Slug IDs verified via mymarketnews.ams.usda.gov on 2026-10-08.
  // If USDA re-numbers in the future and the cron logs "MMN fetch
  // failed for slug XXXX / 404", look up the new ID on
  //   https://mymarketnews.ams.usda.gov/   (search by report title)
  // or the API's master-report-list endpoint, and swap it in here.
  // The row filters (`commodity`, `variety`) also depend on how AMS
  // labels columns in the latest report format — if a report arrives
  // but no row matches, loosen the filter.
  {
    key: 'bs_breast',
    label: 'B/S Chicken Breast',
    unit: 'cents/lb',
    source: 'usda-ams',
    mmnSlug: '3646',   // Weekly National Chicken Report (AMS_3646) — carries B/S breast line
    mmnFilter: { item: 'Breast - B/S', trade_status: 'Domestic', condition: 'Fresh' },
    mmnPriceField: 'wtd_avg_price',
    description: 'USDA AMS — National Chicken Breast (boneless skinless, fresh domestic).',
  },
  {
    key: 'turkey_whole_hen',
    label: 'Turkey Whole Hen',
    unit: 'cents/lb',
    source: 'usda-ams',
    mmnSlug: '3647',   // Weekly National Turkey Report (AMS_3647) — includes 8-16 lb frozen hens
    mmnFilter: { item: 'Whole Young', class: 'Hen', trade_status: 'Domestic' },
    mmnPriceField: 'wtd_avg_price',
    description: 'USDA AMS — Weekly National Turkey Report (whole young hen).',
  },
  {
    key: 'shell_eggs_layer',
    label: 'Shell Eggs (Layer)',
    unit: 'cents/doz',
    source: 'usda-ams',
    mmnSlug: '2843',   // Daily National Shell Egg Index Report (AMS_2843) — graded loose large white
    // Detail rows carry no price column — the index lives in the
    // narrative text, parsed with mmnNarrativeRegex in the cron.
    mmnFilter: { market_location_name: 'National 5 Day Weighted Index' },
    mmnPriceField: 'report_narrative',
    description: 'USDA AMS — Daily National Shell Egg Index (loose large white).',
  },

  // ── Red meat & dairy price watch ──────────────────────────────
  // Lean Hogs + Live Cattle are CME futures (Yahoo chart API, same path
  // as corn/soy). Class III Milk trades on CME too; Class IV is tracked
  // via the USDA AMS Advance / Monthly Class Price announcement.
  {
    key: 'lean_hogs',
    label: 'Lean Hogs',
    unit: 'cents/lb',
    source: 'cbot',
    yahooSymbol: 'HE=F',
    description: 'CME Lean Hogs front-month futures.',
  },
  {
    key: 'live_cattle',
    label: 'Live Cattle',
    unit: 'cents/lb',
    source: 'cbot',
    yahooSymbol: 'LE=F',
    description: 'CME Live Cattle front-month futures.',
  },
  {
    key: 'class_iii_milk',
    label: 'Class III Milk',
    unit: 'USD/cwt',
    source: 'cbot',
    yahooSymbol: 'DC=F',
    description: 'CME Class III Milk front-month futures.',
  },
  {
    key: 'class_iv_milk',
    label: 'Class IV Milk',
    unit: 'USD/cwt',
    source: 'usda-ams',
    // Final Class Prices by Order (AMS_3355, monthly FCPO-MMYY release).
    // Verified via mymarketnews.ams.usda.gov on 2026-10-08. Reports
    // ~2nd calendar day of each month covering the previous month, so
    // the dashboard value may lag 2-30 days — normal for Class IV.
    mmnSlug: '2991',   // Announcement of Class and Component Prices (DYMCLASSPRICES)
    mmnFilter: { commodity: 'Class IV' },
    mmnPriceField: 'price',
    description: 'USDA AMS — Final Federal Milk Order Class IV minimum price (butter / NDM basis).',
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
  // Cents + per-unit prices → 2 decimals so a 1 cent swing on
  // chicken breast or hogs is visible.
  if (unit === 'cents/lb') return value.toFixed(2);
  if (unit === 'cents/doz') return value.toFixed(2);
  if (unit === 'USD/bu') return value.toFixed(2);
  if (unit === 'USD/cwt') return value.toFixed(2);
  // USD/ton (DDGS, SBM) — whole-dollar precision.
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
