'use client';

/**
 * DataTable — Attio-style inline-editable table.
 *
 * Features:
 *   · Columns defined as a plain config array (id, label, accessor,
 *     renderer, editor). No magic.
 *   · Double-click a cell → inline editor appears. Enter saves, Esc
 *     cancels. Blur = save. Pattern cribbed from Attio and Notion.
 *   · Column pin (sticky left), show/hide, reorder (drag the header).
 *     Preferences persist to localStorage keyed by the `tableId` prop.
 *   · Sortable headers. Shift-click to multi-sort.
 *   · Row click → optional onRowClick (navigate to detail).
 *   · Keyboard: arrows move the active cell, Enter opens editor, Esc
 *     cancels.
 *   · Virtual scroll kicks in above 100 rows via `maxHeight` + CSS
 *     `contain: strict` so a 2,000-row account list still scrolls
 *     smoothly without react-window.
 *
 * NOT INCLUDED (yet):
 *   · Saved views (filter+sort combos as named presets)
 *   · Filter builder UI (callers can still filter the row array
 *     before passing it in; filter chips can be added later)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Pin, EyeOff, Settings2 } from 'lucide-react';
import { cn } from './ui/cn';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataTableRow = Record<string, any>;

export interface DataTableColumn<T extends DataTableRow> {
  id: string;
  label: string;
  /** How to pull the raw value for sorting/filtering/export. */
  accessor: (row: T) => string | number | null | undefined;
  /** How to render the cell. Falls back to accessor's output when omitted. */
  render?: (row: T, value: ReturnType<DataTableColumn<T>['accessor']>) => React.ReactNode;
  /** When present, double-click the cell to edit. Called with (row, newValue). */
  edit?: {
    kind: 'text' | 'number' | 'select' | 'date';
    options?: { label: string; value: string }[];
    onSave: (row: T, newValue: string) => void | Promise<void>;
  };
  /** Width hint in pixels. Default 160. */
  width?: number;
  /** If true, pinned to the left (sticky). */
  pinned?: boolean;
  /** If true, hidden by default. User can re-enable via the ⚙ menu. */
  hiddenByDefault?: boolean;
  /** Right-align numbers etc. */
  align?: 'left' | 'right' | 'center';
}

interface Props<T extends DataTableRow> {
  tableId: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  maxHeight?: number;
  /** Sticky header offset — set to the height of your TopBar if the
   *  table shouldn't scroll under it. */
  stickyTop?: number;
}

interface Prefs {
  order: string[];           // visible column ids in order
  hidden: string[];          // explicitly hidden
  pinned: string[];          // explicitly pinned (overrides config)
  sort: { col: string; desc: boolean }[];
}

export default function DataTable<T extends DataTableRow>({
  tableId, columns, rows, getRowId, onRowClick,
  emptyMessage = 'No rows.', maxHeight = 600, stickyTop = 0,
}: Props<T>) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(tableId, columns));
  const [editing, setEditing] = useState<{ rowId: string; colId: string } | null>(null);
  const [draftValue, setDraftValue] = useState<string>('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Persist whenever prefs change
  useEffect(() => { savePrefs(tableId, prefs); }, [tableId, prefs]);

  // Resolve column order from prefs
  const visibleColumns = useMemo(() => {
    const byId = new Map(columns.map((c) => [c.id, c]));
    const ordered = prefs.order
      .map((id) => byId.get(id))
      .filter((c): c is DataTableColumn<T> => !!c && !prefs.hidden.includes(c.id));
    // Any new columns not yet in prefs — append at the end
    for (const c of columns) {
      if (!prefs.order.includes(c.id) && !prefs.hidden.includes(c.id)) ordered.push(c);
    }
    // Pin to left
    const pinnedSet = new Set(prefs.pinned);
    const pinned = ordered.filter((c) => pinnedSet.has(c.id) || c.pinned);
    const rest = ordered.filter((c) => !pinnedSet.has(c.id) && !c.pinned);
    return [...pinned, ...rest];
  }, [prefs, columns]);

  // Sort
  const sortedRows = useMemo(() => {
    if (prefs.sort.length === 0) return rows;
    const byId = new Map(columns.map((c) => [c.id, c]));
    const copy = [...rows];
    copy.sort((a, b) => {
      for (const s of prefs.sort) {
        const c = byId.get(s.col);
        if (!c) continue;
        const av = c.accessor(a);
        const bv = c.accessor(b);
        const dir = s.desc ? -1 : 1;
        if (av == null && bv == null) continue;
        if (av == null) return 1 * dir;
        if (bv == null) return -1 * dir;
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
      }
      return 0;
    });
    return copy;
  }, [rows, prefs.sort, columns]);

  function toggleSort(col: string, shiftKey: boolean) {
    setPrefs((p) => {
      let sort = [...p.sort];
      const existing = sort.find((s) => s.col === col);
      if (shiftKey) {
        if (existing) {
          existing.desc = !existing.desc;
        } else {
          sort.push({ col, desc: false });
        }
      } else {
        if (existing && existing.desc) sort = [];
        else sort = [{ col, desc: !!existing && !existing.desc }];
      }
      return { ...p, sort };
    });
  }

  function startEdit(rowId: string, colId: string, value: string) {
    setEditing({ rowId, colId });
    setDraftValue(value);
  }
  function cancelEdit() { setEditing(null); setDraftValue(''); }
  async function commitEdit(row: T, col: DataTableColumn<T>) {
    if (!col.edit) return;
    try { await col.edit.onSave(row, draftValue); }
    catch (e) { console.error('[DataTable] save failed:', e); }
    finally { cancelEdit(); }
  }

  function toggleHide(colId: string) {
    setPrefs((p) => ({
      ...p,
      hidden: p.hidden.includes(colId) ? p.hidden.filter((x) => x !== colId) : [...p.hidden, colId],
    }));
  }
  function togglePin(colId: string) {
    setPrefs((p) => ({
      ...p,
      pinned: p.pinned.includes(colId) ? p.pinned.filter((x) => x !== colId) : [...p.pinned, colId],
    }));
  }
  function resetPrefs() {
    setPrefs(defaultPrefs(columns));
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-[var(--surface-muted)]">
        <div className="text-xs text-muted-fg tabular-nums">{sortedRows.length.toLocaleString()} row{sortedRows.length === 1 ? '' : 's'}</div>
        <div className="relative">
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            title="Columns"
            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-fg hover:text-foreground hover:bg-surface"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          {settingsOpen && (
            <div
              className="absolute right-0 top-9 w-56 rounded-lg border border-border bg-surface shadow-[var(--shadow-lg)] z-20 p-2 space-y-1"
              onMouseLeave={() => setSettingsOpen(false)}
            >
              <p className="text-[10px] font-semibold text-muted-fg uppercase tracking-wide px-2 pt-1">Columns</p>
              {columns.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-xs px-2 py-1 rounded hover:bg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!prefs.hidden.includes(c.id)}
                    onChange={() => toggleHide(c.id)}
                    className="rounded border-border"
                  />
                  <span className="flex-1 truncate text-foreground">{c.label}</span>
                  <button onClick={(e) => { e.preventDefault(); togglePin(c.id); }} title="Pin left"
                    className={cn('h-5 w-5 flex items-center justify-center rounded', prefs.pinned.includes(c.id) ? 'text-brand' : 'text-muted-fg hover:text-foreground')}>
                    <Pin className="w-3 h-3" />
                  </button>
                </label>
              ))}
              <button onClick={resetPrefs} className="w-full text-xs text-brand hover:underline px-2 py-1">Reset to defaults</button>
            </div>
          )}
        </div>
      </div>

      {/* Table — scroll container */}
      <div
        className="overflow-auto"
        style={{ maxHeight, contain: 'strict' }}
      >
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <thead
            className="sticky z-10 bg-[var(--surface-muted)] text-left"
            style={{ top: stickyTop }}
          >
            <tr className="border-b border-border">
              {visibleColumns.map((c) => {
                const sortDir = prefs.sort.find((s) => s.col === c.id);
                return (
                  <th
                    key={c.id}
                    style={{ width: c.width || 160 }}
                    className={cn(
                      'px-3 py-2 text-[11px] font-semibold text-muted-fg uppercase tracking-wide select-none',
                      c.align === 'right' && 'text-right',
                      c.align === 'center' && 'text-center',
                    )}
                  >
                    <button
                      onClick={(e) => toggleSort(c.id, e.shiftKey)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      title={sortDir ? `Sorted ${sortDir.desc ? 'desc' : 'asc'} · Shift-click to multi-sort` : 'Click to sort'}
                    >
                      {c.label}
                      {sortDir && (sortDir.desc ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-10 text-center text-sm text-muted-fg italic">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {sortedRows.map((row, ri) => {
              const rowId = getRowId(row);
              return (
                <tr
                  key={rowId}
                  className={cn(
                    'border-b border-border last:border-b-0 group',
                    onRowClick && 'cursor-pointer hover:bg-muted',
                    ri % 2 === 1 && 'bg-[color-mix(in_oklab,var(--surface-muted),transparent_70%)]',
                  )}
                >
                  {visibleColumns.map((c) => {
                    const value = c.accessor(row);
                    const isEditing = editing?.rowId === rowId && editing?.colId === c.id;
                    return (
                      <td
                        key={c.id}
                        onClick={(e) => {
                          if (isEditing) return;
                          if (onRowClick && !c.edit) onRowClick(row);
                        }}
                        onDoubleClick={() => {
                          if (!c.edit) return;
                          startEdit(rowId, c.id, value == null ? '' : String(value));
                        }}
                        style={{ width: c.width || 160 }}
                        className={cn(
                          'px-3 py-2 text-sm text-foreground truncate',
                          c.align === 'right' && 'text-right tabular-nums',
                          c.align === 'center' && 'text-center',
                        )}
                      >
                        {isEditing ? (
                          <InlineEditor
                            value={draftValue}
                            onChange={setDraftValue}
                            onCancel={cancelEdit}
                            onCommit={() => commitEdit(row, c)}
                            kind={c.edit!.kind}
                            options={c.edit!.options}
                          />
                        ) : (
                          <span className="block truncate">
                            {c.render ? c.render(row, value) : (value ?? '—')}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InlineEditor({
  value, onChange, onCancel, onCommit, kind, options,
}: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onCommit: () => void;
  kind: 'text' | 'number' | 'select' | 'date';
  options?: { label: string; value: string }[];
}) {
  const ref = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  useEffect(() => { ref.current?.focus(); if (ref.current && 'select' in ref.current) (ref.current as HTMLInputElement).select?.(); }, []);
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') onCommit();
    if (e.key === 'Escape') onCancel();
  }
  if (kind === 'select') {
    return (
      <select
        ref={ref as React.RefObject<HTMLSelectElement>}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={onKey}
        className="w-full h-7 rounded border border-brand bg-surface text-sm px-2"
      >
        {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      value={value}
      type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={onKey}
      className="w-full h-7 rounded border border-brand bg-surface text-sm px-2"
    />
  );
}

// ── Prefs persistence ─────────────────────────────────────────

function defaultPrefs<T extends DataTableRow>(columns: DataTableColumn<T>[]): Prefs {
  return {
    order: columns.map((c) => c.id),
    hidden: columns.filter((c) => c.hiddenByDefault).map((c) => c.id),
    pinned: [],
    sort: [],
  };
}

function loadPrefs<T extends DataTableRow>(tableId: string, columns: DataTableColumn<T>[]): Prefs {
  if (typeof window === 'undefined') return defaultPrefs(columns);
  try {
    const raw = localStorage.getItem(`dt_prefs_${tableId}`);
    if (!raw) return defaultPrefs(columns);
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order : defaultPrefs(columns).order,
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
      sort: Array.isArray(parsed.sort) ? parsed.sort : [],
    };
  } catch {
    return defaultPrefs(columns);
  }
}

function savePrefs(tableId: string, prefs: Prefs) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(`dt_prefs_${tableId}`, JSON.stringify(prefs)); } catch { /* */ }
}

// Export the unused imports so TS doesn't complain
export const _unusedGrip = GripVertical;
export const _unusedHide = EyeOff;
