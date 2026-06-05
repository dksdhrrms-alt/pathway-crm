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

export default function TodayMarketCard() {
  const [entries, setEntries] = useState<CommodityCardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Only need latest + previous trading day, so a 14-day window
        // is more than enough (covers weekends, holidays, USDA's weekly
        // cadence). Keeps the payload tiny on every dashboard load.
        const since = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
        const { data, error: err } = await supabase
          .from('commodity_prices')
          .select('commodity_key, date, price, unit, source')
          .gte('date', since)
          .order('date', { ascending: false });
        if (err) throw err;

        // Group by commodity key, then derive latest / previous.
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
          const stale = latest && cfg.source === 'usda-ams'
            ? `as of ${fmtShortDate(latest.date)}`
            : undefined;
          return { config: cfg, latest, previous, yearAgo: null, asOfNote: stale };
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
          {entries.map(({ config, latest, previous, asOfNote }) => {
            const daily = fmtDelta(latest && previous ? pctDelta(latest.price, previous.price) : null);
            const unitShort = config.unit.replace('USD/', '').replace('cents/', '¢/');
            return (
              <li key={config.key} className="py-2.5 text-sm">
                {/* Name on its own line so it never gets clipped on mobile.
                    Price / unit / delta share a second line that wraps as
                    a unit (smaller right-aligned cluster), keeping the
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
                    <span className={`tabular-nums text-xs w-16 text-right ${TONE_TEXT[daily.tone]}`}>
                      {daily.text}
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
