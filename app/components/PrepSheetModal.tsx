'use client';

/**
 * PrepSheetModal — one-page meeting prep brief, pulled on demand.
 *
 * Usage:
 *   <PrepSheetModal kind="account" id={account.id} onClose={...} />
 *
 * Trigger lives on Account / Contact / Opportunity detail pages
 * ("📋 Prep for next meeting"). The modal POSTs /api/ai/prep-sheet
 * which assembles the data (and asks Claude for 5 meeting questions
 * when ANTHROPIC_API_KEY is set), then renders a print-friendly
 * 1-page layout. The user can Print → Save as PDF from the browser
 * dialog.
 */

import { useEffect, useState } from 'react';

interface Prep {
  subject: { kind: string; id: string; name: string };
  accountId: string;
  accountName: string;
  team: string;
  companyType: string;
  industry: string;
  location: string;
  state: string;
  recentActivities: { date: string; type: string; subject: string; description: string; star: boolean }[];
  openOpps: { name: string; stage: string; amount: number; closeDate: string; nextStep: string }[];
  openTrials: { name: string; phase: string; animalGroup: string; health: string | null; stage: string | null; nextStep: string | null; dueDate: string | null }[];
  news: { title: string; url: string; published_at: string; source: string }[];
  commodities: ({ key: string; latest: number; unit: string; deltaWeekPct: number | null } | null)[];
  ytdSales: number;
  questions: string[];
}

interface Props {
  kind: 'account' | 'contact' | 'opportunity';
  id: string;
  onClose: () => void;
}

export default function PrepSheetModal({ kind, id, onClose }: Props) {
  const [prep, setPrep] = useState<Prep | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/ai/prep-sheet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, id }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
        }
        const j = await r.json() as Prep;
        if (!cancelled) { setPrep(j); setLoading(false); }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [kind, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <PrintStyles />
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto p-3 print:static print:bg-white print:p-0 print:overflow-visible"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-3xl my-6 flex flex-col print:shadow-none print:rounded-none print:max-w-full print:my-0"
          style={{ maxHeight: 'calc(100dvh - 48px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {/* Header — hidden in print */}
          <header className="shrink-0 px-6 py-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between print:hidden">
            <div>
              <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Prep Sheet</p>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{prep?.subject.name || 'Loading…'}</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => window.print()}
                disabled={loading || !!error}
                className="text-sm px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium disabled:opacity-50"
              >
                🖨 Print / Save PDF
              </button>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-800 text-xl"
              >
                ×
              </button>
            </div>
          </header>

          {/* Body */}
          <div className="overflow-y-auto px-6 py-5 flex-1 print:overflow-visible print:p-6" style={{ WebkitOverflowScrolling: 'touch' }}>
            {loading && <p className="text-sm text-gray-400 py-10 text-center">Assembling prep sheet…</p>}
            {error && (
              <div className="p-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
            {prep && !loading && !error && <PrepBody prep={prep} />}
          </div>
        </div>
      </div>
    </>
  );
}

function PrepBody({ prep }: { prep: Prep }) {
  const metaLine = [
    prep.team && `Team: ${prep.team}`,
    prep.companyType,
    prep.industry,
    [prep.location, prep.state].filter(Boolean).join(', '),
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5 text-gray-800 dark:text-gray-200">
      {/* Account meta */}
      <section>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{prep.accountName}</h1>
        {metaLine && <p className="text-xs text-gray-500 mt-0.5">{metaLine}</p>}
        {prep.ytdSales > 0 && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1 font-medium">
            YTD Sales: ${Math.round(prep.ytdSales).toLocaleString()}
          </p>
        )}
      </section>

      {/* AI-generated discussion questions — the headline value */}
      {prep.questions.length > 0 && (
        <section className="rounded-lg border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/10 p-4 print:break-inside-avoid">
          <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-200 mb-2 flex items-center gap-1.5">
            🤖 Discussion questions to ask
          </h2>
          <ol className="list-decimal list-outside ml-5 space-y-1.5 text-[13px] text-emerald-900 dark:text-emerald-100">
            {prep.questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </section>
      )}

      {/* Open opportunities */}
      {prep.openOpps.length > 0 && (
        <section className="print:break-inside-avoid">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">💼 Open Opportunities</h2>
          <div className="space-y-2">
            {prep.openOpps.map((o, i) => (
              <div key={i} className="border border-gray-200 dark:border-slate-700 rounded p-2.5 text-sm">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{o.name}</span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">
                    ${Math.round(o.amount).toLocaleString()}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">{o.stage} · closes {o.closeDate}</p>
                {o.nextStep && <p className="text-[12px] text-gray-700 dark:text-gray-300 mt-1">Next: {o.nextStep}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Open trials */}
      {prep.openTrials.length > 0 && (
        <section className="print:break-inside-avoid">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">🧪 Trials In Progress</h2>
          <div className="space-y-2">
            {prep.openTrials.map((t, i) => (
              <div key={i} className="border border-gray-200 dark:border-slate-700 rounded p-2.5 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{t.name}</span>
                  <span className="text-[11px] text-gray-500">{t.animalGroup} / {t.phase}</span>
                  {t.health && <HealthPill health={t.health} />}
                </div>
                {t.stage && <p className="text-[11px] text-gray-500 mt-0.5">{t.stage}{t.dueDate ? ` · due ${t.dueDate}` : ''}</p>}
                {t.nextStep && <p className="text-[12px] text-gray-700 dark:text-gray-300 mt-1">Next: {t.nextStep}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent activities */}
      <section className="print:break-inside-avoid">
        <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">📞 Recent Activity (last 6 weeks)</h2>
        {prep.recentActivities.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No activity logged in the past 6 weeks.</p>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {prep.recentActivities.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-[11px] text-gray-500 tabular-nums shrink-0 w-16">{a.date.slice(5).replace('-', '/')}</span>
                <span className="shrink-0">{iconFor(a.type)}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-gray-900 dark:text-gray-100">
                    {a.star && <span className="text-amber-500 mr-1">★</span>}
                    {a.subject}
                  </span>
                  {a.description && (
                    <p className="text-[12px] text-gray-600 dark:text-gray-400 mt-0.5 whitespace-pre-wrap leading-snug">
                      {a.description.length > 300 ? a.description.slice(0, 300) + '…' : a.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Commodities + News (side-by-side when wide) */}
      {(prep.commodities.length > 0 || prep.news.length > 0) && (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-5 print:break-inside-avoid">
          {prep.commodities.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">💰 Price Signals</h2>
              <ul className="text-[13px] space-y-1">
                {prep.commodities.filter(Boolean).map((c, i) => {
                  const cc = c as { key: string; latest: number; unit: string; deltaWeekPct: number | null };
                  const tone = cc.deltaWeekPct == null ? 'text-gray-500' : cc.deltaWeekPct > 2 ? 'text-rose-600' : cc.deltaWeekPct < -2 ? 'text-emerald-600' : 'text-gray-500';
                  return (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="text-gray-700 dark:text-gray-300">{cc.key.replace(/_/g, ' ')}</span>
                      <span className="tabular-nums text-gray-900 dark:text-gray-100">
                        {cc.latest.toFixed(2)} <span className="text-[10px] text-gray-500">{cc.unit}</span>
                        {cc.deltaWeekPct !== null && <span className={`ml-1.5 ${tone}`}>({cc.deltaWeekPct > 0 ? '+' : ''}{cc.deltaWeekPct}%)</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {prep.news.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">📰 Recent News</h2>
              <ul className="text-[13px] space-y-1.5">
                {prep.news.map((n, i) => (
                  <li key={i}>
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sky-700 dark:text-sky-400 hover:underline">
                      {n.title}
                    </a>
                    <p className="text-[11px] text-gray-500">{n.source}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function iconFor(type: string): string {
  switch (type) {
    case 'Call': return '📞';
    case 'Meeting': return '🤝';
    case 'Email': return '📧';
    default: return '📝';
  }
}

function HealthPill({ health }: { health: string }) {
  const cls = health === 'Green' ? 'bg-emerald-100 text-emerald-800'
    : health === 'Amber' ? 'bg-amber-100 text-amber-800'
    : 'bg-red-100 text-red-800';
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}>{health}</span>;
}

function PrintStyles() {
  return (
    <style jsx global>{`
      @media print {
        body { background: white !important; }
        .print\\:hidden { display: none !important; }
        .print\\:static { position: static !important; }
        .print\\:bg-white { background: white !important; }
        .print\\:p-0 { padding: 0 !important; }
        .print\\:p-6 { padding: 1.5rem !important; }
        .print\\:overflow-visible { overflow: visible !important; }
        .print\\:shadow-none { box-shadow: none !important; }
        .print\\:rounded-none { border-radius: 0 !important; }
        .print\\:max-w-full { max-width: 100% !important; }
        .print\\:my-0 { margin-top: 0 !important; margin-bottom: 0 !important; }
        .print\\:break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
      }
    `}</style>
  );
}
