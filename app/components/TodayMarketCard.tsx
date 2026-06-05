'use client';

/**
 * Today's Market — home dashboard widget.
 *
 * Surfaces the five feed-input prices we track (Soybean Oil, Corn,
 * Soybean Meal, DDGS, Choice White Grease) with daily and YoY %
 * changes. YoY uses the closest-available row to the same date one
 * year ago; if we don't yet have a year of history we render '—'.
 *
 * Data is read straight from the `commodity_prices` table via the
 * client-side Supabase singleton; no API hop. We only need the latest
 * row, the closest prior trading day, and the closest one-year-ago
 * row per commodity, so we pull a small window (last 380 days) per
 * key in parallel.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  COMMODITIES,
  fmtPrice,
  fmtDelta,
  fmtShortDate,
  pctDelta,
  type CommodityKey,
  type PriceRow,
  type CommodityCardEntry,
} from '@/lib/commodities';

const TONE_TEXT: Record<string, string> = {
  up: 'text-rose-600 dark:text-rose-400',
  down: 'text-emerald-600 dark:text-emerald-400',
  flat: 'text-gray-500 dark:text-gray-400',
  na: 'text-gray-400 dark:text-gray-500',
};

/**
 * Pick the row whose date is closest to (latestDate - 1 year), within
 * a ±21-day window. Wider than 14 to absorb weekly USDA cadence + the
 * occasional skipped publication. Returns null when nothing qualifies.
 */
function findClosestYearAgo(rows: PriceRow[], latestDate: string): PriceRow | null {
  const target = new Date(`${latestDate}T00:00:00Z`).getTime() - 365 * 86400000;
  const WINDOW_MS = 21 * 86400000;
  let best: { row: PriceRow; diff: number } | null = null;
  for (const r of rows) {
    const t = new Date(`${r.date}T00:00:00Z`).getTime();
    const diff = Math.abs(t - target);
    if (diff > WINDOW_MS) continue;
    if (!best || diff < best.diff) best = { row: r, diff };
  }
  return best?.row ?? null;
}

export default function TodayMarketCard() {
  const [entries, setEntries] = useState<CommodityCardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // ~13 months window covers the YoY column (latest vs ~365d
        // ago + a buffer for weekends, holidays, and USDA's weekly
        // cadence). Still tiny — 5 commodities × ~290 rows worst case.
        const since = new Date(Date.now() - 400 * 86400000).toISOString().split('T')[0];
        const { data, error: err } = await supabase
          .from('commodity_prices')
          .select('commodity_key, date, price, unit, source')
          .gte('date', since)
          .order('date', { ascending: false });
        if (err) throw err;

        // Group by commodity key, then derive latest / previous / year-ago.
        const byKey = new Map<CommodityKey, PriceRow[]>();
        for (const r of (data ?? []) as Array<{ commodity_key: string; date: string; price: string | number; unit: string; source: string }>) {
          const key = r.commodity_key as CommodityKey;
          const row: PriceRow = {
            commodityKey: key,
            date: r.date,
            price: Number(r.price),
            unit: r.unit,
            source: r.source,
          };
          const arr = byKey.get(key) ?? [];
          arr.push(row);
          byKey.set(key, arr);
        }

        const next: CommodityCardEntry[] = COMMODITIES.map((cfg) => {
          const rows = byKey.get(cfg.key) ?? [];
          const latest = rows[0] ?? null;            // already sorted DESC
          const previous = rows[1] ?? null;
          const yearAgo = latest ? findClosestYearAgo(rows, latest.date) : null;
          const stale = latest && cfg.source === 'usda-ams'
            ? `as of ${fmtShortDate(latest.date)}`
            : undefined;
          return { config: cfg, latest, previous, yearAgo, asOfNote: stale };
        });

        if (!cancelled) {
          setEntries(next);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const latestAnyDate = entries.find((e) => e.latest?.source === 'cbot')?.latest?.date;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Today&apos;s Feed Market
        </h2>
        {latestAnyDate && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {fmtShortDate(latestAnyDate)} close
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading prices…</div>
      ) : error ? (
        <div className="text-sm text-rose-600 dark:text-rose-400 py-4">{error}</div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {entries.map(({ config, latest, previous, yearAgo, asOfNote }) => {
            const daily = fmtDelta(latest && previous ? pctDelta(latest.price, previous.price) : null);
            const yoy = fmtDelta(latest && yearAgo ? pctDelta(latest.price, yearAgo.price) : null);
            const unitShort = config.unit.replace('USD/', '').replace('cents/', '¢/');
            return (
              <li key={config.key} className="py-2.5 text-sm">
                {/* Name on its own line so it never gets clipped on mobile.
                    Price / unit / day-Δ / YoY-Δ share a second line that
                    wraps as a unit (right-aligned cluster), keeping the
                    important "name vs number" grouping intact. */}
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-gray-900 dark:text-gray-100 font-medium" title={config.description}>
                    {config.label}
                  </div>
                  <div className="flex items-baseline gap-2 whitespace-nowrap">
                    <span className="tabular-nums text-gray-900 dark:text-gray-100">
                      {latest ? fmtPrice(latest.price, config.unit) : '—'}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                      {unitShort}
                    </span>
                    <span
                      className={`tabular-nums text-xs w-16 text-right ${TONE_TEXT[daily.tone]}`}
                      title="vs previous trading day / weekly report"
                    >
                      {daily.text}
                    </span>
                    <span
                      className={`tabular-nums text-xs w-20 text-right ${TONE_TEXT[yoy.tone]}`}
                      title={yearAgo ? `YoY vs ${fmtShortDate(yearAgo.date)}` : 'Year-over-year (insufficient history)'}
                    >
                      {yoy.text === '—' ? '—' : `${yoy.text} YoY`}
                    </span>
                  </div>
                </div>
                {asOfNote && (
                  <div className="text-[11px] text-gray-400 dark:text-gray-500">{asOfNote}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
        CBOT closes via Yahoo Finance · USDA AMS cash references
      </div>
    </div>
  );
}
