'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/lib/CRMContext';

type Result = { type: 'Account' | 'Contact' | 'Opportunity' | 'Activity'; id: string; name: string; sub: string; href: string };

const TYPE_COLOR: Record<string, string> = {
  Account: 'bg-blue-100 text-blue-700',
  Contact: 'bg-green-100 text-green-700',
  Opportunity: 'bg-purple-100 text-purple-700',
  Activity: 'bg-orange-100 text-orange-700',
};

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { accounts, contacts, opportunities, activities } = useCRM();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setOpen(true); }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 50); setQuery(''); setSelectedIdx(0); }
  }, [open]);

  const results: Result[] = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const items: Result[] = [];
    accounts.filter(a => a.name.toLowerCase().includes(q)).slice(0, 4)
      .forEach(a => items.push({ type: 'Account', id: a.id, name: a.name, sub: String(a.industry || a.category || ''), href: `/accounts/${a.id}` }));
    contacts.filter(c => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)).slice(0, 4)
      .forEach(c => items.push({ type: 'Contact', id: c.id, name: `${c.firstName} ${c.lastName}`, sub: c.title || '', href: `/contacts/${c.id}` }));
    opportunities.filter(o => o.name.toLowerCase().includes(q)).slice(0, 3)
      .forEach(o => items.push({ type: 'Opportunity', id: o.id, name: o.name, sub: `${o.stage} · $${Number(o.amount).toLocaleString()}`, href: `/opportunities/${o.id}` }));
    activities.filter(a => (a.subject || '').toLowerCase().includes(q)).slice(0, 3)
      .forEach(a => items.push({ type: 'Activity', id: a.id, name: a.subject, sub: `${a.type} · ${a.date}`, href: `/accounts/${a.accountId}` }));
    return items.slice(0, 10);
  }, [query, accounts, contacts, opportunities, activities]);

  useEffect(() => { setSelectedIdx(0); }, [results]);

  function navigate(href: string) { router.push(href); setOpen(false); }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[selectedIdx]) navigate(results[selectedIdx].href);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search accounts, contacts, deals, activities..."
            className="flex-1 text-sm outline-none bg-transparent text-gray-800 placeholder-gray-400"
          />
          <kbd className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        {results.length > 0 ? (
          <ul className="max-h-80 overflow-y-auto py-2">
            {results.map((r, i) => (
              <li key={r.id + r.type}>
                <button
                  onClick={() => navigate(r.href)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === selectedIdx ? 'bg-gray-50' : ''}`}
                >
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${TYPE_COLOR[r.type]}`}>{r.type}</span>
                  <span className="text-sm font-medium text-gray-800 truncate">{r.name}</span>
                  {r.sub && <span className="text-xs text-gray-400 truncate ml-auto">{r.sub}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : query.trim() ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">No results for &quot;{query}&quot;</div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            <p>Type to search across all records</p>
            <p className="text-xs mt-1 text-gray-300">Accounts · Contacts · Deals · Activities</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-100 px-4 py-2 flex gap-4 text-xs text-gray-400">
          <span><kbd className="bg-gray-100 px-1 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="bg-gray-100 px-1 rounded">↵</kbd> open</span>
          <span><kbd className="bg-gray-100 px-1 rounded">ESC</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
