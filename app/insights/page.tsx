'use client';

/**
 * /insights — "What needs my attention today?" dashboard.
 *
 * Five modules computed server-side in /api/insights/dashboard:
 *   1. At-risk customers   (overdue cadence / declining / silent)
 *   2. Likely to reorder    (predicted next-order window)
 *   3. Whitespace           (cross-sell — products peers buy)
 *   4. Stuck deals          (opps with no recent activity)
 *   5. Anomaly watch        (unusual order-size swings)
 *
 * The top "Your day at a glance" band shows a one-line summary. Each
 * card row links to the relevant Account / Opportunity page for the
 * full drill-in.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import TopBar from '@/app/components/TopBar';
import LoadingSpinner from '@/app/components/LoadingSpinner';

interface AtRiskItem {
  accountName: string;
  reason: 'overdue' | 'declining' | 'silent';
  detail: string;
  lastOrder: string;
  lifetimeValue: number;
}
interface ReorderItem {
  accountName: string;
  predictedDate: string;
  daysUntil: number;
  expectedAmount: number;
}
interface WhitespaceItem {
  accountName: string;
  product: string;
  peerAdoption: number;
  avgPeerSpend: number;
}
interface StuckDealItem {
  opportunityId: string;
  name: string;
  accountName: string;
  stage: string;
  amount: number;
  daysSinceActivity: number;
}
interface AnomalyItem {
  accountName: string;
  direction: 'spike' | 'drop';
  currentMonth: number;
  baseline: number;
  ratio: number;
}
interface InsightsPayload {
  summary: string;
  atRisk: AtRiskItem[];
  likelyReorder: ReorderItem[];
  whitespace: WhitespaceItem[];
  stuckDeals: StuckDealItem[];
  anomalies: AnomalyItem[];
  generatedAt: string;
}

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000)      return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

/** Build a deep-link to the Accounts list filtered by a single name. The
 *  Accounts page reads `?q=` for its search input, so a click jumps the
 *  user directly to the relevant account row without an extra step. */
function accountLink(name: string): string {
  return `/accounts?q=${encodeURIComponent(name)}`;
}

const REASON_TONE: Record<AtRiskItem['reason'], { bg: string; fg: string; label: string }> = {
  overdue:   { bg: 'bg-amber-50 dark:bg-amber-950/30', fg: 'text-amber-700 dark:text-amber-300', label: 'Overdue' },
  declining: { bg: 'bg-orange-50 dark:bg-orange-950/30', fg: 'text-orange-700 dark:text-orange-300', label: 'Declining' },
  silent:    { bg: 'bg-rose-50 dark:bg-rose-950/30', fg: 'text-rose-700 dark:text-rose-300', label: 'Silent' },
};

export default function InsightsPage() {
  const [data, setData] = useState<InsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/insights/dashboard');
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const j = await res.json() as InsightsPayload;
      setData(j);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar placeholder="Search insights..." />

      <main className="pt-16 px-4 md:px-8 py-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-7 h-7 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Insights
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              AI-powered daily action plan. Refreshed in real time from your sales, opportunities, and activities.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Day at a glance — purple band */}
        {!loading && data && (
          <div className="rounded-xl border border-purple-200 dark:border-purple-900/60 bg-purple-50 dark:bg-purple-950/30 px-4 py-3 mb-4">
            <div className="flex items-center gap-2 text-xs font-medium text-purple-700 dark:text-purple-300 mb-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              Your day at a glance
            </div>
            <div className="text-sm text-purple-900 dark:text-purple-200 leading-relaxed">
              {data.summary}
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
            Failed to load insights: {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20"><LoadingSpinner /></div>
        ) : data ? (
          <>
            {/* 2x2 grid: At-risk · Reorder · Whitespace · Stuck */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <AtRiskCard items={data.atRisk} />
              <ReorderCard items={data.likelyReorder} />
              <WhitespaceCard items={data.whitespace} />
              <StuckDealsCard items={data.stuckDeals} />
            </div>

            {/* Full-width anomaly row */}
            <AnomalyCard items={data.anomalies} />
          </>
        ) : null}
      </main>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Card components — each is small and self-contained.
// All cards follow the same shell so the page reads as a cohesive grid.
// ──────────────────────────────────────────────────────────────────────

function CardShell({
  icon, iconColor, title, count, subtitle, emptyText, hasRows, children,
}: {
  icon: React.ReactNode; iconColor: string; title: string; count: number;
  subtitle: string; emptyText: string; hasRows: boolean; children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <span className={iconColor}>{icon}</span>
          {title}
        </div>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
          {count}
        </span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{subtitle}</p>
      <div className="border-t border-gray-100 dark:border-slate-800 -mx-1">
        {hasRows ? children : (
          <div className="text-xs text-gray-500 dark:text-gray-500 italic px-1 py-3 text-center">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

function AtRiskCard({ items }: { items: AtRiskItem[] }) {
  return (
    <CardShell
      title="At-risk customers"
      subtitle="Overdue cadence · declining spend · gone silent"
      count={items.length}
      hasRows={items.length > 0}
      emptyText="Everyone is on cadence. Nice."
      iconColor="text-red-500 dark:text-red-400"
      icon={
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      }
    >
      {items.map((it) => {
        const tone = REASON_TONE[it.reason];
        return (
          <Link
            key={it.accountName}
            href={accountLink(it.accountName)}
            className="flex items-center justify-between gap-2 px-1 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 rounded transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{it.accountName}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{it.detail}</div>
            </div>
            <div className="flex flex-col items-end flex-shrink-0">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${tone.bg} ${tone.fg}`}>
                {tone.label}
              </span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                LTV {fmtUSD(it.lifetimeValue)}
              </span>
            </div>
          </Link>
        );
      })}
    </CardShell>
  );
}

function ReorderCard({ items }: { items: ReorderItem[] }) {
  return (
    <CardShell
      title="Likely to reorder"
      subtitle="Predicted next 14 days · based on past cadence"
      count={items.length}
      hasRows={items.length > 0}
      emptyText="No reliable predictions right now."
      iconColor="text-emerald-600 dark:text-emerald-400"
      icon={
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      }
    >
      {items.map((it) => (
        <Link
          key={it.accountName}
          href={accountLink(it.accountName)}
          className="flex items-center justify-between gap-2 px-1 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 rounded transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{it.accountName}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {it.daysUntil <= 0 ? 'due now' : `in ${it.daysUntil} day${it.daysUntil === 1 ? '' : 's'}`} · ~{fmtUSD(it.expectedAmount)}
            </div>
          </div>
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex-shrink-0">
            {it.predictedDate}
          </span>
        </Link>
      ))}
    </CardShell>
  );
}

function WhitespaceCard({ items }: { items: WhitespaceItem[] }) {
  return (
    <CardShell
      title="Cross-sell · whitespace"
      subtitle="Products peers buy that this customer doesn't"
      count={items.length}
      hasRows={items.length > 0}
      emptyText="No clear whitespace gaps right now."
      iconColor="text-purple-600 dark:text-purple-400"
      icon={
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
      }
    >
      {items.map((it, i) => (
        <Link
          key={`${it.accountName}|${it.product}|${i}`}
          href={accountLink(it.accountName)}
          className="flex items-center justify-between gap-2 px-1 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 rounded transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {it.accountName} <span className="text-gray-400 dark:text-gray-500">→</span> {it.product}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {Math.round(it.peerAdoption * 100)}% of peers buy this · est. {fmtUSD(it.avgPeerSpend)}/yr
            </div>
          </div>
        </Link>
      ))}
    </CardShell>
  );
}

function StuckDealsCard({ items }: { items: StuckDealItem[] }) {
  return (
    <CardShell
      title="Stuck deals"
      subtitle="Open opps with no activity in 21+ days · top by value"
      count={items.length}
      hasRows={items.length > 0}
      emptyText="No deals stalling. Pipeline moving."
      iconColor="text-amber-600 dark:text-amber-400"
      icon={
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      }
    >
      {items.map((it) => (
        <Link
          key={it.opportunityId}
          href={`/opportunities/${it.opportunityId}`}
          className="flex items-center justify-between gap-2 px-1 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 rounded transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{it.name}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{it.accountName} · {it.stage}</div>
          </div>
          <div className="flex flex-col items-end flex-shrink-0">
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{fmtUSD(it.amount)}</span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{it.daysSinceActivity}d quiet</span>
          </div>
        </Link>
      ))}
    </CardShell>
  );
}

function AnomalyCard({ items }: { items: AnomalyItem[] }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <span className="text-orange-600 dark:text-orange-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.24 17 6.343 18.5 8 18 10 18 10s1.5 1.5 1.657 2.343" />
            </svg>
          </span>
          Anomaly watch
        </div>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Unusual swings worth a look — bigger or smaller than typical for the account
      </p>
      <div className="border-t border-gray-100 dark:border-slate-800 -mx-1">
        {items.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-gray-500 italic px-1 py-3 text-center">
            No unusual patterns this month.
          </div>
        ) : (
          items.map((it, i) => (
            <Link
              key={`${it.accountName}|${i}`}
              href={accountLink(it.accountName)}
              className="flex items-center justify-between gap-2 px-1 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 rounded transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{it.accountName}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  This month {fmtUSD(it.currentMonth)} vs baseline {fmtUSD(it.baseline)} — {it.ratio}× normal
                </div>
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                it.direction === 'spike'
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
              }`}>
                {it.direction === 'spike' ? 'Spike' : 'Drop'}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
