'use client';

/**
 * Industry News — home dashboard widget.
 *
 * Shows the two articles the 6am cron picked for today. If today's
 * batch hasn't been written yet (early morning, cron hasn't run, or
 * Anthropic was down) we fall back to the most recent surface_date
 * that has rows — so the card never goes blank on the user.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmtNewsTime } from '@/lib/news';

interface Row {
  id: string;
  surface_date: string;
  title: string;
  summary: string;
  why_it_matters: string | null;
  category: string | null;
  source_url: string;
  source_name: string | null;
  published_at: string | null;
  rank: number;
}

const CATEGORY_COLOR: Record<string, string> = {
  Disease:    'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
  Regulatory: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  Market:     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  Customer:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  Technology: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200',
};

export default function IndustryNewsCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [surfaceDate, setSurfaceDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Grab the most recent surface_date with data and read its rows.
        // Single query: order by date desc, take first 4 — handles 'today
        // empty, yesterday has 2' and the typical 'today has 2' case
        // without a second round trip.
        const { data, error: err } = await supabase
          .from('industry_news')
          .select('*')
          .order('surface_date', { ascending: false })
          .order('rank', { ascending: true })
          .limit(4);
        if (err) throw err;
        const list = (data ?? []) as Row[];
        if (list.length === 0) {
          if (!cancelled) {
            setRows([]);
            setLoading(false);
          }
          return;
        }
        const latestDate = list[0].surface_date;
        const todayRows = list.filter((r) => r.surface_date === latestDate).slice(0, 2);
        if (!cancelled) {
          setRows(todayRows);
          setSurfaceDate(latestDate);
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

  const todayIso = new Date().toISOString().split('T')[0];
  const isStale = surfaceDate && surfaceDate !== todayIso;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm h-full">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Industry News
        </h2>
        {surfaceDate && (
          <span className={`text-xs ${isStale ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
            {isStale ? `last batch: ${surfaceDate}` : 'today'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading…</div>
      ) : error ? (
        <div className="text-sm text-rose-600 dark:text-rose-400 py-4">{error}</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">
          No items yet. The morning cron will populate this card.
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-gray-100 dark:border-slate-800 last:border-0 pb-3 last:pb-0">
              <div className="flex items-start gap-2 mb-1">
                {r.category && (
                  <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${CATEGORY_COLOR[r.category] ?? 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300'}`}>
                    {r.category}
                  </span>
                )}
                <a
                  href={r.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:underline leading-snug flex-1"
                >
                  {r.title}
                </a>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                {r.summary}
              </p>
              {r.why_it_matters && (
                <p className="text-xs text-emerald-700 dark:text-emerald-300 italic leading-relaxed mt-1">
                  Why it matters: {r.why_it_matters}
                </p>
              )}
              <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                {r.source_name}
                {r.published_at && <> · {fmtNewsTime(r.published_at)}</>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
        Curated daily by Claude AI from livestock industry sources.
      </div>
    </div>
  );
}
