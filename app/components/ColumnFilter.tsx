'use client';

import { useState, useRef, useEffect, useMemo } from 'react';

interface ColumnFilterProps {
  values: string[];           // all unique values present in this column (already sorted)
  selected: Set<string>;      // currently selected values; empty Set means "no filter / show all"
  onChange: (s: Set<string>) => void;
  label?: string;
}

const EMPTY_LABEL = '(Empty)';

export default function ColumnFilter({ values, selected, onChange, label }: ColumnFilterProps) {
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

  const filtered = useMemo(() => {
    if (!search.trim()) return values;
    const q = search.toLowerCase();
    return values.filter((v) => (v || EMPTY_LABEL).toLowerCase().includes(q));
  }, [values, search]);

  const isFiltering = selected.size > 0 && selected.size < values.length;

  function isChecked(v: string): boolean {
    return selected.size === 0 || selected.has(v);
  }

  function toggle(v: string) {
    const current = selected.size === 0 ? new Set(values) : new Set(selected);
    if (current.has(v)) current.delete(v); else current.add(v);
    if (current.size === values.length) onChange(new Set());
    else onChange(current);
  }

  function selectAll() { onChange(new Set()); }
  function clearAll() {
    // Show only currently-checked-zero values: equivalent to filtering out everything.
    // We use a sentinel that won't match any real value so result is empty.
    onChange(new Set(['__none__']));
  }
  function selectOnly(v: string) { onChange(new Set([v])); }

  return (
    <span className="relative inline-block ml-1" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`inline-flex items-center justify-center w-4 h-4 rounded transition-colors ${isFiltering ? 'text-green-700 bg-green-100' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-200'}`}
        title={isFiltering ? `Filtered (${selected.size})` : 'Filter'}
        aria-label="Filter column"
      >
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v1.586a1 1 0 01-.293.707L12 11.414V16a1 1 0 01-1.447.894l-2-1A1 1 0 018 15v-3.586L3.293 6.707A1 1 0 013 6V4z" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-30 normal-case"
          onClick={(e) => e.stopPropagation()}
        >
          {label && <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">{label}</div>}
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <div className="flex justify-between px-3 py-1.5 text-[11px] border-b border-gray-100 bg-gray-50">
            <button type="button" onClick={selectAll} className="text-blue-600 hover:underline">Select all</button>
            <button type="button" onClick={clearAll} className="text-gray-500 hover:underline">Clear</button>
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-gray-400">No matches</li>
            ) : filtered.map((v) => (
              <li key={v} className="group flex items-center justify-between gap-1 px-2 py-1 hover:bg-gray-50">
                <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={isChecked(v)}
                    onChange={() => toggle(v)}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500 flex-shrink-0"
                  />
                  <span className="truncate">{v || <span className="text-gray-400 italic">{EMPTY_LABEL}</span>}</span>
                </label>
                <button
                  type="button"
                  onClick={() => selectOnly(v)}
                  className="text-[10px] text-blue-600 hover:underline opacity-0 group-hover:opacity-100 flex-shrink-0"
                  title="Show only this"
                >
                  only
                </button>
              </li>
            ))}
          </ul>
          {isFiltering && (
            <div className="px-3 py-1.5 text-[10px] text-green-700 bg-green-50 border-t border-green-100">
              {selected.size} of {values.length} selected
            </div>
          )}
        </div>
      )}
    </span>
  );
}
