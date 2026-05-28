'use client';

/**
 * /insights — "What needs my attention today?" dashboard.
 *
 * Five sales-rep-focused modules, computed in /api/insights/dashboard:
 *
 *   1. Likely to reorder    — predicted next-order window
 *   2. Time to call         — overdue cadence, weighted by account size
 *   3. Closing this month   — opps with close date in next 30 days
 *   4. Personal touchpoints — contact birthdays / anniversaries
 *   5. Top spenders waiting — high-LTV accounts gone quiet (safety net)
 *
 * Every row deep-links to the relevant /accounts/[id] or /opportunities/[id]
 * detail view (NOT the filtered list).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import TopBar from '@/app/components/TopBar';
import LoadingSpinner from '@/app/components/LoadingSpinner';

interface ReorderItem {
  accountId: string;
  accountName: string;
  predictedDate: string;
  daysUntil: number;
  expectedAmount: number;
}
interface TimeToCallItem {
  accountId: string;
  accountName: string;
  daysSinceActivity: number;
  lastActivityType: string;
  lastActivityDate: string;
  lifetimeValue: number;
}
interface ClosingItem {
  opportunityId: string;
  name: string;
  accountId: string;
  accountName: string;
  stage: string;
  amount: number;
  probability: number;
  weightedAmount: number;
  closeDate: string;
  daysUntilClose: number;
}
interface TouchpointItem {
  contactId: string;
  contactName: string;
  accountId: string;
  accountName: string;
  type: 'birthday' | 'anniversary';
  date: string;
  daysUntil: number;
}
interface TopSpenderItem {
  accountId: string;
  accountName: string;
  lifetimeValue: number;
  daysSinceActivity: number;
  lastActivityType: string;
}
interface InsightsPayload {
  summary: string;
  likelyReorder: ReorderItem[];
  timeToCall: TimeToCallItem[];
  closing: ClosingItem[];
  personalTouchpoints: TouchpointItem[];
  topSpenders: TopSpenderItem[];
  generatedAt: string;
}

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000)      return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

/** Deep-link to a specific account or list fallback when the API couldn't
 *  resolve an ID (rare — only when accountName has no matching row). */
function acctHref(id: string, fallbackName: string): string {
  return id ? `/accounts/${id}` : `/accounts?q=${encodeURIComponent(fallbackName)}`;
}

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
              Your daily sales plan, built from the activity, pipeline, and order data already in the CRM.
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

        {/* Day at a glance */}
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
            {/* 2x2 grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <ReorderCard items={data.likelyReorder} />
              <TimeToCallCard items={data.timeToCall} />
              <ClosingCard items={data.closing} />
              <TouchpointsCard items={data.personalTouchpoints} />
            </div>

            {/* Full-width safety net */}
            <TopSpendersCard items={data.topSpenders} />
          </>
        ) : null}
      </main>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Card shell — single source of truth for layout.
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

// ──────────────────────────────────────────────────────────────────────
// 1) Likely to reorder
// ──────────────────────────────────────────────────────────────────────
function ReorderCard({ items }: { items: ReorderItem[] }) {
  return (
    <CardShell
      title="Likely to reorder"
      subtitle="Predicted within 14 days · based on past cadence"
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
          key={it.accountId || it.accountName}
          href={acctHref(it.accountId, it.accountName)}
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

// ──────────────────────────────────────────────────────────────────────
// 2) Time to call
// ──────────────────────────────────────────────────────────────────────
function TimeToCallCard({ items }: { items: TimeToCallItem[] }) {
  return (
    <CardShell
      title="Time to call"
      subtitle="Active accounts that haven't been touched in a while"
      count={items.length}
      hasRows={items.length > 0}
      emptyText="You're on top of every account. Take a coffee break."
      iconColor="text-blue-600 dark:text-blue-400"
      icon={
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
      }
    >
      {items.map((it) => (
        <Link
          key={it.accountId}
          href={acctHref(it.accountId, it.accountName)}
          className="flex items-center justify-between gap-2 px-1 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 rounded transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{it.accountName}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {it.lastActivityType !== 'never'
                ? `Last ${it.lastActivityType.toLowerCase()} ${it.lastActivityDate}`
                : 'No activity logged yet'}
            </div>
          </div>
          <div className="flex flex-col items-end flex-shrink-0">
            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{it.daysSinceActivity}d quiet</span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">LTV {fmtUSD(it.lifetimeValue)}</span>
          </div>
        </Link>
      ))}
    </CardShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 3) Closing this month
// ──────────────────────────────────────────────────────────────────────
function ClosingCard({ items }: { items: ClosingItem[] }) {
  return (
    <CardShell
      title="Closing this month"
      subtitle="Opps with close date in the next 30 days · weighted by value × probability"
      count={items.length}
      hasRows={items.length > 0}
      emptyText="No opps scheduled to close in the next 30 days."
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
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {it.accountName} · {it.stage} · {it.probability}%
            </div>
          </div>
          <div className="flex flex-col items-end flex-shrink-0">
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{fmtUSD(it.amount)}</span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {it.daysUntilClose <= 0 ? 'overdue' : `${it.daysUntilClose}d left`}
            </span>
          </div>
        </Link>
      ))}
    </CardShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 4) Personal touchpoints (birthdays / anniversaries)
// ──────────────────────────────────────────────────────────────────────
function TouchpointsCard({ items }: { items: TouchpointItem[] }) {
  return (
    <CardShell
      title="Personal touchpoint"
      subtitle="Contact birthdays and anniversaries in the next 14 days"
      count={items.length}
      hasRows={items.length > 0}
      emptyText="No birthdays or anniversaries this fortnight."
      iconColor="text-pink-500 dark:text-pink-400"
      icon={
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
        </svg>
      }
    >
      {items.map((it) => (
        <Link
          key={`${it.contactId}-${it.type}`}
          href={acctHref(it.accountId, it.accountName)}
          className="flex items-center justify-between gap-2 px-1 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 rounded transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{it.contactName}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {it.accountName} · {it.type === 'birthday' ? 'Birthday' : 'Anniversary'} {it.date}
            </div>
          </div>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
            it.type === 'birthday'
              ? 'bg-pink-50 dark:bg-pink-950/30 text-pink-700 dark:text-pink-300'
              : 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300'
          }`}>
            {it.daysUntil === 0 ? 'today' : `in ${it.daysUntil}d`}
          </span>
        </Link>
      ))}
    </CardShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 5) Top spenders waiting — full-width safety net
// ──────────────────────────────────────────────────────────────────────
function TopSpendersCard({ items }: { items: TopSpenderItem[] }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <span className="text-rose-600 dark:text-rose-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" />
            </svg>
          </span>
          Top spenders waiting
        </div>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Your highest-LTV accounts that have gone 45+ days without contact. Don&apos;t lose these.
      </p>
      <div className="border-t border-gray-100 dark:border-slate-800 -mx-1">
        {items.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-gray-500 italic px-1 py-3 text-center">
            All major accounts have been contacted recently. Great work.
          </div>
        ) : (
          items.map((it) => (
            <Link
              key={it.accountId}
              href={acctHref(it.accountId, it.accountName)}
              className="flex items-center justify-between gap-2 px-1 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 rounded transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{it.accountName}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {it.lastActivityType !== 'never' ? `Last touch: ${it.lastActivityType.toLowerCase()}` : 'No activity logged'}
                </div>
              </div>
              <div className="flex flex-col items-end flex-shrink-0">
                <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">LTV {fmtUSD(it.lifetimeValue)}</span>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{it.daysSinceActivity}d quiet</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
