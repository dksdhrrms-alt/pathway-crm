'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useCRM } from '@/lib/CRMContext';
import { buildAccountSubtitleMap } from '@/lib/accountDisplay';

const SPECIES_BADGE: Record<string, { bg: string; text: string }> = {
  'Dairy/Beef': { bg: '#E1F5EE', text: '#0F6E56' },
  Poultry: { bg: '#E6F1FB', text: '#185FA5' },
  Swine: { bg: '#FAEEDA', text: '#854F0B' },
  'Feed Mill': { bg: '#EEEDFE', text: '#534AB7' },
  Other: { bg: '#F1EFE8', text: '#5F5E5A' },
};

interface Props {
  value: string;
  onChange: (accountName: string, accountId: string) => void;
  placeholder?: string;
}

export default function AccountSearchSelect({ value, onChange, placeholder }: Props) {
  const { accounts } = useCRM();
  const [search, setSearch] = useState(value || '');
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setSearch(value || ''); }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Subtitle map for same-named accounts (e.g. "Visser Dairy - WI" vs "- IA").
  // Recomputes when the account list updates; O(1) lookup per row.
  const subtitleMap = useMemo(() => buildAccountSubtitleMap(accounts), [accounts]);

  const filtered = accounts.filter((a) => a.name.toLowerCase().includes(search.toLowerCase())).slice(0, 20);

  return (
    <div ref={ref} className="relative">
      <input
        type="text" value={search}
        onChange={(e) => { setSearch(e.target.value); setIsOpen(true); }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder || 'Search accounts...'}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-slate-800 dark:border-slate-600 dark:text-gray-100 dark:placeholder-gray-500"
      />
      {isOpen && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto z-50 dark:bg-slate-900 dark:border-slate-600">
          {filtered.map((a) => {
            const badge = SPECIES_BADGE[a.industry] || SPECIES_BADGE.Other;
            const subtitle = subtitleMap.get(a.id) || '';
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => { setSearch(a.name); onChange(a.name, a.id); setIsOpen(false); }}
                className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors dark:hover:bg-slate-800"
              >
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{a.name}</span>
                  {subtitle ? (
                    <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-400 whitespace-nowrap">
                      {subtitle}
                    </span>
                  ) : null}
                </div>
                {a.industry ? (
                  <span
                    className="text-[11px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                    style={{ backgroundColor: badge.bg, color: badge.text }}
                  >
                    {a.industry}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      {isOpen && search && filtered.length === 0 ? (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-50 dark:bg-slate-900 dark:border-slate-600">
          <p className="text-sm text-gray-400 dark:text-gray-500">No accounts found</p>
        </div>
      ) : null}
    </div>
  );
}
