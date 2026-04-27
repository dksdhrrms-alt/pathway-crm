'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useCRM } from '@/lib/CRMContext';

interface Props {
  value: string;                              // currently selected parent accountId
  onChange: (id: string) => void;
  excludeAccountId?: string;                  // exclude self (so an account can't parent itself or descend into a cycle)
  placeholder?: string;
}

// Returns the set of accountIds that are `id` or any descendant of `id`.
// Used to prevent assigning a parent that would create a cycle.
function collectDescendants(id: string, accounts: { id: string; parentAccountId?: string }[]): Set<string> {
  const result = new Set<string>([id]);
  let added = true;
  while (added) {
    added = false;
    for (const a of accounts) {
      if (a.parentAccountId && result.has(a.parentAccountId) && !result.has(a.id)) {
        result.add(a.id);
        added = true;
      }
    }
  }
  return result;
}

export default function AccountParentSelector({ value, onChange, excludeAccountId, placeholder }: Props) {
  const { accounts } = useCRM();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Disallow self + descendants as parent (cycle prevention)
  const blocked = useMemo(() => {
    if (!excludeAccountId) return new Set<string>();
    return collectDescendants(excludeAccountId, accounts);
  }, [excludeAccountId, accounts]);

  const selectedName = useMemo(() => accounts.find((a) => a.id === value)?.name || '', [accounts, value]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return accounts
      .filter((a) => !blocked.has(a.id))
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .slice(0, 30)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts, search, blocked]);

  return (
    <div className="relative" ref={ref}>
      <div className="flex gap-2">
        <input
          type="text"
          readOnly
          value={selectedName}
          onClick={() => setOpen(!open)}
          placeholder={placeholder || 'Search parent account... (optional)'}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 cursor-pointer bg-white"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="px-3 py-2 text-xs text-gray-500 hover:text-red-600 border border-gray-300 rounded-lg hover:border-red-300"
            title="Remove parent"
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-30">
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts..."
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-gray-400">No accounts match</li>
            ) : filtered.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => { onChange(a.id); setOpen(false); setSearch(''); }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-green-50 hover:text-green-800 ${value === a.id ? 'bg-green-50 text-green-800 font-medium' : 'text-gray-700'}`}
                >
                  {a.name}
                  {a.country && <span className="text-xs text-gray-400 ml-2">{a.country}</span>}
                </button>
              </li>
            ))}
          </ul>
          {excludeAccountId && (
            <p className="px-3 py-1.5 text-[10px] text-gray-400 border-t border-gray-100 bg-gray-50">
              Self and descendant accounts are hidden to prevent cycles.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
