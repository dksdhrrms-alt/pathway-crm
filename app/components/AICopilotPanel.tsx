'use client';

/**
 * AICopilotPanel — persistent "Ask CRM" rail that lives on the right
 * edge of every CRM page.
 *
 * Open with Cmd/Ctrl+Shift+K or by clicking the floating sparkles
 * button in the bottom-right. The panel slides in from the right,
 * takes a question in natural language, hits /api/ai/ask-crm, and
 * renders the resulting rows in a scrollable table.
 *
 * Why a rail, not a modal? Modals steal the whole screen and reset
 * when you dismiss them. A rail lets reps keep their current page
 * (e.g. an Account) in view while they ask follow-ups like "which
 * of these contacts also work on the Dairy team?"
 */

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, X, Loader2, PanelRightClose } from 'lucide-react';
import { Button } from './ui/Button';

interface HistoryItem {
  role: 'user' | 'assistant';
  content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows?: any[];
  headers?: string[];
  errored?: boolean;
}

const SUGGESTED = [
  'When is Simplot likely to place an order?',
  'Which of my deals is most at risk of stalling?',
  'What should I follow up on today?',
  'Trials in progress with Amber or Red health',
  'Give me a brief on the Kalmbach account',
];

export default function AICopilotPanel() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Global hotkey: Cmd/Ctrl + Shift + K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [history, loading]);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setHistory((h) => [...h, { role: 'user', content: trimmed }]);
    setQuestion('');
    setLoading(true);
    try {
      const r = await fetch('/api/ai/ask-crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const j = await r.json();
      if (!r.ok) {
        setHistory((h) => [...h, { role: 'assistant', content: j.error || `Error ${r.status}`, errored: true }]);
      } else {
        setHistory((h) => [...h, {
          role: 'assistant',
          content: j.answer || '',
          rows: j.rows || [],
          headers: j.headers || [],
        }]);
      }
    } catch (e) {
      setHistory((h) => [...h, {
        role: 'assistant',
        content: e instanceof Error ? e.message : String(e),
        errored: true,
      }]);
    } finally { setLoading(false); }
  }

  return (
    <>
      {/* FAB — labelled pill so it's unambiguously "Ask CRM" and
          not confused with Smart Log (which lives at bottom-right).
          Positioned bottom-LEFT to physically separate the two
          different-purpose entry points:
            · Ask CRM  (purple/sparkles, bottom-left)  → questions
            · Smart Log (green pill, bottom-right)     → log activities
            · + Quick Log (green circle, bottom-right) → structured form
      */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Ask a question about your CRM data (Cmd+Shift+K)"
          aria-label="Open Ask CRM"
          className="fixed bottom-7 left-7 md:left-[calc(15rem+1.75rem)] z-40 inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full bg-indigo-600 text-white shadow-[var(--shadow-lg)] hover:bg-indigo-700 press-nudge text-sm font-medium"
        >
          <Sparkles className="w-4 h-4" />
          Ask CRM
        </button>
      )}

      {/* Rail */}
      <aside
        className={`fixed top-0 right-0 h-full z-40 bg-surface border-l border-border flex flex-col transition-transform duration-200 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: 'min(420px, 95vw)', boxShadow: open ? 'var(--shadow-xl)' : 'none' }}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand" />
            <h3 className="text-sm font-semibold text-foreground">Ask CRM</h3>
            <span className="text-[10px] text-muted-fg">Cmd+Shift+K</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="w-8 h-8 rounded-md flex items-center justify-center text-muted-fg hover:text-foreground hover:bg-muted"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>

        {/* Conversation body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {history.length === 0 && !loading && (
            <div className="text-sm text-muted-fg space-y-3">
              <p>Natural-language questions against your CRM. Try:</p>
              <ul className="space-y-1.5">
                {SUGGESTED.map((s) => (
                  <li key={s}>
                    <button
                      onClick={() => ask(s)}
                      className="text-left w-full px-3 py-2 rounded-md border border-border hover:border-brand hover:bg-brand-tint transition-colors text-xs text-foreground"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {history.map((item, i) =>
            item.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] bg-brand-tint text-foreground px-3 py-2 rounded-lg text-sm">
                  {item.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className={`max-w-full w-full ${item.errored ? 'text-destructive' : 'text-foreground'}`}>
                  {/* Multi-paragraph answer. The new API returns a
                      reasoned response with a "Suggested next steps:"
                      bullet list — preserve newlines so it reads as
                      intended. */}
                  <AnswerBlock text={item.content} />
                  {item.rows && item.rows.length > 0 && item.headers && (
                    <div className="mt-2">
                      <ResultTable rows={item.rows} headers={item.headers} />
                    </div>
                  )}
                </div>
              </div>
            ),
          )}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-fg">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Thinking…
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); ask(question); }}
          className="shrink-0 border-t border-border p-3 flex items-end gap-2"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <input
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about your CRM…"
            className="flex-1 h-9 rounded-lg border border-input bg-surface text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-ring)] focus:border-brand"
          />
          <Button type="submit" size="icon" loading={loading} disabled={!question.trim()}>
            {!loading && <Send className="w-4 h-4" />}
          </Button>
          {history.length > 0 && (
            <button type="button" onClick={() => setHistory([])}
              className="h-9 px-2 rounded-md text-muted-fg hover:text-foreground hover:bg-muted text-xs"
              title="Clear conversation">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </form>
      </aside>

      {/* Backdrop on mobile (not clickable — rail isn't modal, user
          can keep working on the underlying page). Just dims so the
          rail isn't fighting the content for attention. */}
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ResultTable({ rows, headers }: { rows: any[]; headers: string[] }) {
  // Trim obviously massive columns that cause overflow (id/uuid fields).
  const displayHeaders = headers.filter((h) => rows[0][h] !== undefined).slice(0, 6);
  return (
    <div className="rounded-md border border-border overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="bg-[var(--surface-muted)]">
          <tr>
            {displayHeaders.map((h) => (
              <th key={h} className="text-left px-2 py-1.5 font-medium text-muted-fg whitespace-nowrap">
                {h.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 30).map((r, i) => (
            <tr key={i} className="border-t border-border">
              {displayHeaders.map((h) => (
                <td key={h} className="px-2 py-1.5 text-foreground whitespace-nowrap max-w-[180px] truncate" title={String(r[h] ?? '')}>
                  {formatCell(r[h])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 30 && (
        <div className="text-[10px] text-muted-fg px-2 py-1 border-t border-border bg-[var(--surface-muted)]">
          Showing 30 of {rows.length}
        </div>
      )}
    </div>
  );
}

/**
 * AnswerBlock — renders the reasoned answer from /api/ai/ask-crm.
 * The route returns plain text that typically ends with a
 * "Suggested next steps:" bullet list; we split on that line and
 * render the bullets as a styled list for readability.
 */
function AnswerBlock({ text }: { text: string }) {
  if (!text) return null;
  const marker = /suggested next steps\s*:/i;
  const match = text.match(marker);
  if (!match || match.index === undefined) {
    return <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{text}</div>;
  }
  const body = text.slice(0, match.index).trim();
  const after = text.slice(match.index + match[0].length).trim();
  const bullets = after
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•\d.)\s]+/, '').trim())
    .filter(Boolean);
  return (
    <div className="space-y-3">
      {body && <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{body}</div>}
      {bullets.length > 0 && (
        <div className="rounded-lg border border-border bg-[var(--surface-muted)] p-3">
          <div className="text-[10px] font-semibold text-brand uppercase tracking-wide mb-1.5">Suggested next steps</div>
          <ul className="space-y-1 text-sm text-foreground">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-2 leading-snug">
                <span className="text-brand mt-0.5 shrink-0">→</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatCell(v: any): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '✓' : '—';
  if (typeof v === 'number') return v.toLocaleString();
  const s = String(v);
  if (s.length > 60) return s.slice(0, 60) + '…';
  return s;
}
