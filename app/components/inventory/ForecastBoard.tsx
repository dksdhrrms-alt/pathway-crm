'use client';

/**
 * ForecastBoard — Excel-style monthly IN/OUT/Balance projection per
 * product × location. Mirrors the "재고관리 계획" workbook the team
 * has been keeping by hand:
 *
 *   <Location>
 *     IN   supplier1    [Jul] [Aug] [Sep] … [Jun]
 *     OUT  customer1    [Jul] [Aug] [Sep] … [Jun]
 *     OUT  customer2    [Jul] [Aug] [Sep] … [Jun]
 *     Balance                                       ← computed
 *
 * One product at a time (picker at the top) — that's how the Excel
 * is organized too and a 7-product × 6-location × 24-month matrix
 * would be unreadable in one view.
 *
 * Balance line is computed on the fly so it never goes stale:
 *   monthN_balance = monthN-1_balance + sum(in) − sum(out)
 *
 * Scenario toggle (Best / Expected / Worst) filters which rows feed
 * the IN/OUT — same product × location can carry parallel scenario
 * rows and the rep picks which view they want.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Product, Location, ForecastRow, ForecastDirection, ForecastScenario,
  listProducts, listLocations, listForecasts, listStockLots,
  upsertForecast, deleteForecast,
} from '@/lib/inventory';

const MONTHS_AHEAD = 24;

function formatErr(e: unknown): string {
  if (!e) return 'Unknown error';
  if (e instanceof Error) return e.message;
  if (typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean);
    if (parts.length > 0) return parts.join(' — ');
  }
  return String(e);
}

// Build a 24-month timeline starting at the current month.
function buildMonths(start: Date): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  for (let i = 0; i < MONTHS_AHEAD; i++) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    out.push({ iso, label });
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

export default function ForecastBoard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [openingBalance, setOpeningBalance] = useState<Map<string, number>>(new Map()); // key = `${productId}|${locationId}`
  const [productId, setProductId] = useState<string>('');
  const [scenario, setScenario] = useState<ForecastScenario>('expected');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, l, f, lots] = await Promise.all([
        listProducts(), listLocations(), listForecasts(), listStockLots(),
      ]);
      setProducts(p); setLocations(l); setForecasts(f);
      // Opening balance = sum of in_stock (not upcoming, not sold) per
      // product × location. The forecast Balance row starts from here
      // and applies the monthly deltas going forward.
      const bal = new Map<string, number>();
      for (const lot of lots) {
        if (lot.status !== 'in_stock') continue;
        const k = `${lot.productId}|${lot.locationId}`;
        bal.set(k, (bal.get(k) || 0) + lot.quantity);
      }
      setOpeningBalance(bal);
      if (!productId && p.length > 0) setProductId(p[0].id);
    } catch (e) {
      setError(formatErr(e));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const months = useMemo(() => buildMonths(new Date()), []);
  const product = products.find((p) => p.id === productId);

  if (loading) return <div className="py-12 text-center text-gray-500 dark:text-gray-400">Loading…</div>;
  if (products.length === 0 || locations.length === 0) {
    return (
      <div className="py-12 text-center text-gray-500 dark:text-gray-400">
        <p className="text-base font-medium text-gray-700 dark:text-gray-200 mb-1">Set up products and locations first</p>
        <p className="text-sm">Open <strong>Manage products / locations</strong> at the top right.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-500 dark:text-gray-400">Product</label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)}
            className="border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="inline-flex bg-gray-100 dark:bg-slate-800 p-1 rounded-md">
            {(['best', 'expected', 'worst'] as ForecastScenario[]).map((s) => (
              <button key={s} onClick={() => setScenario(s)}
                className={`px-2.5 py-1 text-xs rounded ${scenario === s ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                {s === 'best' ? 'Best' : s === 'expected' ? 'Expected' : 'Worst'}
              </button>
            ))}
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Opening balance from in-stock lots. {MONTHS_AHEAD}-month horizon.</div>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}

      {product && (
        <div className="space-y-4">
          {locations.map((loc) => (
            <LocationForecastBlock
              key={loc.id}
              product={product}
              location={loc}
              months={months}
              scenario={scenario}
              rows={forecasts.filter((r) => r.productId === product.id && r.locationId === loc.id && r.scenario === scenario)}
              opening={openingBalance.get(`${product.id}|${loc.id}`) || 0}
              onReload={load}
              onError={setError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LocationForecastBlock({
  product, location, months, scenario, rows, opening, onReload, onError,
}: {
  product: Product;
  location: Location;
  months: { iso: string; label: string }[];
  scenario: ForecastScenario;
  rows: ForecastRow[];
  opening: number;
  onReload: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const ins = rows.filter((r) => r.direction === 'in');
  const outs = rows.filter((r) => r.direction === 'out');

  // Balance trail — opening + cumulative (sum(in) − sum(out)) per month.
  const balance = useMemo(() => {
    let b = opening;
    return months.map((m) => {
      const inSum = ins.filter((r) => r.month.startsWith(m.iso.slice(0, 7))).reduce((s, r) => s + r.quantity, 0);
      const outSum = outs.filter((r) => r.month.startsWith(m.iso.slice(0, 7))).reduce((s, r) => s + r.quantity, 0);
      b = b + inSum - outSum;
      return b;
    });
  }, [opening, months, ins, outs]);

  async function add(direction: ForecastDirection) {
    try {
      await upsertForecast({
        productId: product.id, locationId: location.id,
        month: months[0].iso, direction, party: direction === 'in' ? 'New supplier' : 'New customer',
        quantity: 0, scenario,
      });
      await onReload();
    } catch (e) { onError(formatErr(e)); }
  }

  return (
    <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-slate-800/60">
        {location.color && <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: location.color }} />}
        <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{location.code}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">opening {opening.toLocaleString()} kg</span>
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => add('in')} className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white">+ IN row</button>
          <button onClick={() => add('out')} className="text-xs px-2 py-1 rounded bg-amber-700 hover:bg-amber-800 text-white">+ OUT row</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs min-w-full">
          <thead className="bg-gray-100/60 dark:bg-slate-800/30">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium text-gray-500 dark:text-gray-400 sticky left-0 bg-gray-100/60 dark:bg-slate-800/60 z-10 min-w-[180px]">Row</th>
              {months.map((m) => (
                <th key={m.iso} className="px-1.5 py-1.5 text-right font-medium text-gray-500 dark:text-gray-400 min-w-[56px]">{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ins.map((r) => (
              <ForecastEditableRow key={r.id} row={r} months={months}
                label={`IN · ${r.party || 'supplier'}`} accent="bg-emerald-50/40 dark:bg-emerald-950/20"
                onReload={onReload} onError={onError} />
            ))}
            {outs.map((r) => (
              <ForecastEditableRow key={r.id} row={r} months={months}
                label={`OUT · ${r.party || 'customer'}`} accent="bg-amber-50/40 dark:bg-amber-950/20"
                onReload={onReload} onError={onError} />
            ))}
            {(ins.length === 0 && outs.length === 0) && (
              <tr><td colSpan={months.length + 1} className="px-3 py-4 text-center text-gray-400 dark:text-gray-500 italic">No forecast rows yet — click + IN row or + OUT row.</td></tr>
            )}
            <tr className="bg-gray-50 dark:bg-slate-800/40 font-semibold sticky bottom-0">
              <td className="px-2 py-1.5 text-gray-700 dark:text-gray-200 sticky left-0 bg-gray-100 dark:bg-slate-800 z-10">Balance</td>
              {balance.map((b, i) => (
                <td key={months[i].iso}
                  className={`px-1.5 py-1.5 text-right ${b < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>
                  {b.toLocaleString()}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ForecastEditableRow({
  row, months, label, accent, onReload, onError,
}: {
  row: ForecastRow;
  months: { iso: string; label: string }[];
  label: string;
  accent: string;
  onReload: () => Promise<void>;
  onError: (e: string) => void;
}) {
  // The row carries one month's quantity. We render a cell per month
  // in the timeline, but only the cell whose month matches `row.month`
  // is non-empty. To support multi-month entries the rep adds extra
  // rows. Editing in any cell creates / updates the row for that month.
  const [draftParty, setDraftParty] = useState(row.party || '');
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState<string>('');

  async function saveParty() {
    if (draftParty === (row.party || '')) return;
    try {
      await upsertForecast({ ...row, party: draftParty });
      await onReload();
    } catch (e) { onError(formatErr(e)); }
  }

  async function deleteRow() {
    if (!confirm(`Delete this ${row.direction === 'in' ? 'IN' : 'OUT'} row?`)) return;
    try { await deleteForecast(row.id); await onReload(); }
    catch (e) { onError(formatErr(e)); }
  }

  async function commitCell(monthIso: string) {
    const v = parseFloat(editingQty);
    if (Number.isNaN(v)) { setEditingMonth(null); return; }
    try {
      if (monthIso === row.month) {
        if (v === 0) {
          await deleteForecast(row.id);
        } else {
          await upsertForecast({ ...row, quantity: v });
        }
      } else if (v !== 0) {
        await upsertForecast({
          productId: row.productId, locationId: row.locationId,
          month: monthIso, direction: row.direction, party: row.party,
          quantity: v, scenario: row.scenario,
        });
      }
      setEditingMonth(null);
      await onReload();
    } catch (e) { onError(formatErr(e)); }
  }

  return (
    <tr className={accent}>
      <td className="px-2 py-1 sticky left-0 bg-inherit z-10 min-w-[180px]">
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {label.split(' · ')[0]}
          </span>
          <input value={draftParty} onChange={(e) => setDraftParty(e.target.value)} onBlur={saveParty}
            placeholder={label.includes('IN') ? 'supplier' : 'customer'}
            className="flex-1 min-w-0 border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-1 py-0.5 text-xs focus:outline-none" />
          <button
            onClick={deleteRow}
            title="Delete row"
            className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded px-1 text-xs flex-shrink-0"
          >×</button>
        </div>
      </td>
      {months.map((m) => {
        const isThisRowMonth = m.iso === row.month;
        const isEditing = editingMonth === m.iso;
        return (
          <td key={m.iso}
            className={`px-1.5 py-1 text-right ${isThisRowMonth ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-400 dark:text-gray-600'} hover:bg-emerald-100/30 dark:hover:bg-emerald-900/20 cursor-text`}
            onClick={() => {
              if (isEditing) return;
              setEditingMonth(m.iso);
              setEditingQty(isThisRowMonth ? String(row.quantity) : '');
            }}>
            {isEditing ? (
              <input autoFocus type="number" value={editingQty}
                onChange={(e) => setEditingQty(e.target.value)}
                onBlur={() => commitCell(m.iso)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { setEditingMonth(null); } }}
                className="w-14 text-right border border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-1 py-0.5 text-xs focus:outline-none" />
            ) : (
              isThisRowMonth ? row.quantity.toLocaleString() : '·'
            )}
          </td>
        );
      })}
    </tr>
  );
}
