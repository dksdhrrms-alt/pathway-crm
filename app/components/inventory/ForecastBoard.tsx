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
  Product, Location, ForecastRow, ForecastDirection, ForecastScenario, StockLot,
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

type ViewMode = 'per_location' | 'consolidated';

// A synthetic (read-only) IN row derived from an upcoming stock lot.
// One row per (locationId, manufacturer) group so multiple upcoming
// containers from the same supplier at the same warehouse collapse
// visually, mirroring how the team thinks about them.
interface UpcomingGroup {
  key: string;
  locationId: string;
  manufacturer: string;   // display value ('' → 'Upcoming')
  monthQty: Map<string, number>; // monthIso → total kg landing that month
  lotIds: string[];       // for the tooltip / debugging
}

function buildUpcomingGroups(lots: StockLot[]): UpcomingGroup[] {
  const map = new Map<string, UpcomingGroup>();
  for (const lot of lots) {
    if (!lot.etaDate) continue;
    // Bucket to first day of the ETA's month, matching how forecast
    // rows are keyed.
    const monthIso = `${lot.etaDate.slice(0, 7)}-01`;
    const manu = (lot.manufacturer || '').trim();
    const key = `${lot.locationId}|${manu.toLowerCase()}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        locationId: lot.locationId,
        manufacturer: manu || 'Upcoming',
        monthQty: new Map(),
        lotIds: [],
      };
      map.set(key, g);
    }
    g.monthQty.set(monthIso, (g.monthQty.get(monthIso) || 0) + lot.quantity);
    g.lotIds.push(lot.id);
  }
  return Array.from(map.values());
}

export default function ForecastBoard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  // Upcoming stock lots (status='upcoming' + eta_date set). These
  // auto-populate IN rows in the forecast board so the rep doesn't
  // have to double-enter them. Editable only from the Snapshot tab.
  const [upcomingLots, setUpcomingLots] = useState<StockLot[]>([]);
  const [openingBalance, setOpeningBalance] = useState<Map<string, number>>(new Map()); // key = `${productId}|${locationId}`
  const [productId, setProductId] = useState<string>('');
  const [scenario, setScenario] = useState<ForecastScenario>('expected');
  // Consolidated view mirrors the team's Excel: all locations folded
  // into one table per product, single Balance row summing across all
  // of them. Per-location is the original Phase-2 grid.
  const [viewMode, setViewMode] = useState<ViewMode>('consolidated');
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
      // Upcoming lots with an ETA go straight into the forecast IN
      // side. Ones with no ETA are ignored here (can't place them
      // on the timeline) — they still show on the Snapshot tab.
      setUpcomingLots(lots.filter((lt) => lt.status === 'upcoming' && !!lt.etaDate));
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
          <div className="inline-flex bg-gray-100 dark:bg-slate-800 p-1 rounded-md">
            <button onClick={() => setViewMode('consolidated')}
              className={`px-2.5 py-1 text-xs rounded ${viewMode === 'consolidated' ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400'}`}
              title="One table per product, all locations combined; bottom Balance = sum across all locations">
              Consolidated
            </button>
            <button onClick={() => setViewMode('per_location')}
              className={`px-2.5 py-1 text-xs rounded ${viewMode === 'per_location' ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400'}`}
              title="Separate IN/OUT/Balance block per location">
              Per location
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Opening balance from in-stock lots. {MONTHS_AHEAD}-month horizon.</div>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}

      {product && viewMode === 'per_location' && (
        <div className="space-y-4">
          {locations.map((loc) => (
            <LocationForecastBlock
              key={loc.id}
              product={product}
              location={loc}
              months={months}
              scenario={scenario}
              rows={forecasts.filter((r) => r.productId === product.id && r.locationId === loc.id && r.scenario === scenario)}
              upcomingLots={upcomingLots.filter((lt) => lt.productId === product.id && lt.locationId === loc.id)}
              opening={openingBalance.get(`${product.id}|${loc.id}`) || 0}
              onReload={load}
              onError={setError}
            />
          ))}
        </div>
      )}

      {product && viewMode === 'consolidated' && (
        <ConsolidatedForecastBlock
          product={product}
          locations={locations}
          months={months}
          scenario={scenario}
          rows={forecasts.filter((r) => r.productId === product.id && r.scenario === scenario)}
          upcomingLots={upcomingLots.filter((lt) => lt.productId === product.id)}
          openingByLocation={openingBalance}
          onReload={load}
          onError={setError}
        />
      )}
    </div>
  );
}

function LocationForecastBlock({
  product, location, months, scenario, rows, upcomingLots, opening, onReload, onError,
}: {
  product: Product;
  location: Location;
  months: { iso: string; label: string }[];
  scenario: ForecastScenario;
  rows: ForecastRow[];
  upcomingLots: StockLot[];
  opening: number;
  onReload: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const ins = rows.filter((r) => r.direction === 'in');
  const outs = rows.filter((r) => r.direction === 'out');
  const upcomingGroups = useMemo(() => buildUpcomingGroups(upcomingLots), [upcomingLots]);

  // Balance trail — opening + cumulative (sum(in) + sum(upcoming) − sum(out)) per month.
  const balance = useMemo(() => {
    let b = opening;
    return months.map((m) => {
      const prefix = m.iso.slice(0, 7);
      const inSum = ins.filter((r) => r.month.startsWith(prefix)).reduce((s, r) => s + r.quantity, 0);
      const outSum = outs.filter((r) => r.month.startsWith(prefix)).reduce((s, r) => s + r.quantity, 0);
      const upcomingSum = upcomingGroups.reduce((s, g) => s + (g.monthQty.get(m.iso) || 0), 0);
      b = b + inSum + upcomingSum - outSum;
      return b;
    });
  }, [opening, months, ins, outs, upcomingGroups]);

  async function add(direction: ForecastDirection) {
    // Use a unique placeholder party name so the new row doesn't
    // collapse into an existing group (we group by party). The rep
    // then renames it inline.
    const stamp = new Date().toISOString().slice(11, 19);
    const placeholder = `${direction === 'in' ? 'New supplier' : 'New customer'} (${stamp})`;
    try {
      await upsertForecast({
        productId: product.id, locationId: location.id,
        month: months[0].iso, direction, party: placeholder,
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
            {upcomingGroups.map((g) => (
              <UpcomingSyntheticRow key={g.key} group={g} months={months} />
            ))}
            {groupForecastRows(ins).map((g) => (
              <GroupedForecastRow key={g.key} group={g} months={months}
                label={`IN · ${g.party || 'supplier'}`} accent="bg-emerald-50/40 dark:bg-emerald-950/20"
                onReload={onReload} onError={onError} />
            ))}
            {groupForecastRows(outs).map((g) => (
              <GroupedForecastRow key={g.key} group={g} months={months}
                label={`OUT · ${g.party || 'customer'}`} accent="bg-amber-50/40 dark:bg-amber-950/20"
                onReload={onReload} onError={onError} />
            ))}
            {(ins.length === 0 && outs.length === 0 && upcomingGroups.length === 0) && (
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

// One logical row = (productId, locationId, direction, party). The
// underlying DB row schema stores a separate record per month, so we
// fold them together in JS and present a single editable row whose
// cells map to each month. Adding a value in a new month edits the
// SAME row instead of spawning a new one (which was the original
// confusing behavior — see Excel parity).
interface ForecastGroup {
  key: string;            // `${locationId}|${direction}|${partyKey}`
  productId: string;
  locationId: string;
  direction: ForecastDirection;
  scenario: ForecastScenario;
  party: string;          // canonical display value (first non-empty)
  monthRows: Map<string, ForecastRow>; // monthIso → DB row
}

function groupForecastRows(rows: ForecastRow[]): ForecastGroup[] {
  const groups = new Map<string, ForecastGroup>();
  for (const r of rows) {
    const partyKey = (r.party || '').trim().toLowerCase();
    const key = `${r.locationId}|${r.direction}|${partyKey}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        productId: r.productId,
        locationId: r.locationId,
        direction: r.direction,
        scenario: r.scenario,
        party: r.party || '',
        monthRows: new Map(),
      };
      groups.set(key, g);
    }
    g.monthRows.set(r.month, r);
    if (!g.party && r.party) g.party = r.party;
  }
  return Array.from(groups.values());
}

function GroupedForecastRow({
  group, months, label, accent, locationChip, onReload, onError,
}: {
  group: ForecastGroup;
  months: { iso: string; label: string }[];
  label: string;
  accent: string;
  // When set, render a small color swatch + code before the IN/OUT
  // label. Used by the consolidated view so the rep can tell at a
  // glance which warehouse the row belongs to.
  locationChip?: { code: string; color: string | null };
  onReload: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [draftParty, setDraftParty] = useState(group.party);
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState<string>('');

  // Bulk-rename: update every DB row in this group so the party stays
  // in sync. Sequential awaits keep the optimistic UI simple — typical
  // group size is 1-12 rows.
  async function saveParty() {
    const next = draftParty.trim();
    if (next === group.party.trim()) return;
    try {
      for (const r of group.monthRows.values()) {
        await upsertForecast({ ...r, party: next });
      }
      await onReload();
    } catch (e) { onError(formatErr(e)); }
  }

  // Bulk-delete the whole logical row (all months).
  async function deleteRow() {
    if (!confirm(`Delete this ${group.direction === 'in' ? 'IN' : 'OUT'} row across all months?`)) return;
    try {
      for (const r of group.monthRows.values()) {
        await deleteForecast(r.id);
      }
      await onReload();
    } catch (e) { onError(formatErr(e)); }
  }

  async function commitCell(monthIso: string) {
    const raw = editingQty.trim();
    const existing = group.monthRows.get(monthIso);
    setEditingMonth(null);
    try {
      // Empty input = clear the cell
      if (raw === '') {
        if (existing) await deleteForecast(existing.id);
      } else {
        const v = parseFloat(raw);
        if (Number.isNaN(v)) return;
        if (existing) {
          if (v === 0) await deleteForecast(existing.id);
          else await upsertForecast({ ...existing, quantity: v });
        } else if (v !== 0) {
          // No DB row for that month yet — insert a fresh one carrying
          // the group's identity. This is what makes "type a value into
          // any month cell" land in the same logical row.
          await upsertForecast({
            productId: group.productId, locationId: group.locationId,
            month: monthIso, direction: group.direction, party: group.party || null,
            quantity: v, scenario: group.scenario,
          });
        }
      }
      await onReload();
    } catch (e) { onError(formatErr(e)); }
  }

  return (
    <tr className={accent}>
      <td className="px-2 py-1 sticky left-0 bg-inherit z-10 min-w-[220px]">
        <div className="flex items-center gap-1">
          {locationChip && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded bg-gray-200/70 dark:bg-slate-700/60 text-gray-700 dark:text-gray-200 flex-shrink-0">
              {locationChip.color && <span className="inline-block w-1.5 h-1.5 rounded-sm" style={{ backgroundColor: locationChip.color }} />}
              {locationChip.code}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {label.split(' · ')[0]}
          </span>
          <input value={draftParty} onChange={(e) => setDraftParty(e.target.value)} onBlur={saveParty}
            placeholder={label.includes('IN') ? 'supplier' : 'customer'}
            className="flex-1 min-w-0 border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-1 py-0.5 text-xs focus:outline-none" />
          <button
            onClick={deleteRow}
            title="Delete row (all months)"
            className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded px-1 text-xs flex-shrink-0"
          >×</button>
        </div>
      </td>
      {months.map((m) => {
        const dbRow = group.monthRows.get(m.iso);
        const hasValue = dbRow !== undefined;
        const isEditing = editingMonth === m.iso;
        return (
          <td key={m.iso}
            className={`px-1.5 py-1 text-right ${hasValue ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-400 dark:text-gray-600'} hover:bg-emerald-100/30 dark:hover:bg-emerald-900/20 cursor-text`}
            onClick={() => {
              if (isEditing) return;
              setEditingMonth(m.iso);
              setEditingQty(hasValue ? String(dbRow!.quantity) : '');
            }}>
            {isEditing ? (
              <input autoFocus type="number" value={editingQty}
                onChange={(e) => setEditingQty(e.target.value)}
                onBlur={() => commitCell(m.iso)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { setEditingMonth(null); } }}
                className="w-14 text-right border border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-1 py-0.5 text-xs focus:outline-none" />
            ) : (
              hasValue ? dbRow!.quantity.toLocaleString() : '·'
            )}
          </td>
        );
      })}
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────
// Consolidated view: one table per product, every location folded
// into the same grid. Mirrors the team's Excel "재고관리" sheet
// where each row is a location/party and the bottom Balance row
// sums across all of them.
// ─────────────────────────────────────────────────────────────────
function ConsolidatedForecastBlock({
  product, locations, months, scenario, rows, upcomingLots, openingByLocation, onReload, onError,
}: {
  product: Product;
  locations: Location[];
  months: { iso: string; label: string }[];
  scenario: ForecastScenario;
  rows: ForecastRow[];
  upcomingLots: StockLot[];
  openingByLocation: Map<string, number>;
  onReload: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [addLocationId, setAddLocationId] = useState<string>(locations[0]?.id || '');

  // Total opening balance = sum across every location for this product.
  const opening = useMemo(() => {
    let sum = 0;
    for (const loc of locations) {
      sum += openingByLocation.get(`${product.id}|${loc.id}`) || 0;
    }
    return sum;
  }, [product.id, locations, openingByLocation]);

  const ins = rows.filter((r) => r.direction === 'in');
  const outs = rows.filter((r) => r.direction === 'out');

  // Group DB rows by (location, direction, party) so multi-month
  // entries fold into a single visual row. Then sort the GROUPS by
  // location order, then party — that's how the Excel reads top-down.
  const locOrder = new Map(locations.map((l, i) => [l.id, i]));
  const sortGroups = (a: ForecastGroup, b: ForecastGroup) => {
    const la = locOrder.get(a.locationId) ?? 999;
    const lb = locOrder.get(b.locationId) ?? 999;
    if (la !== lb) return la - lb;
    return a.party.localeCompare(b.party);
  };
  const inGroups = groupForecastRows(ins).sort(sortGroups);
  const outGroups = groupForecastRows(outs).sort(sortGroups);
  // Auto-derived IN rows from upcoming stock lots. Sorted by location
  // then manufacturer.
  const upcomingGroups = useMemo(() => {
    const gs = buildUpcomingGroups(upcomingLots);
    gs.sort((a, b) => {
      const la = locOrder.get(a.locationId) ?? 999;
      const lb = locOrder.get(b.locationId) ?? 999;
      if (la !== lb) return la - lb;
      return a.manufacturer.localeCompare(b.manufacturer);
    });
    return gs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingLots]);

  // Balance trail — same formula as per-location, but the deltas
  // include every IN/OUT regardless of location, plus upcoming lots
  // landing that month.
  const balance = useMemo(() => {
    let b = opening;
    return months.map((m) => {
      const prefix = m.iso.slice(0, 7);
      const inSum = ins.filter((r) => r.month.startsWith(prefix)).reduce((s, r) => s + r.quantity, 0);
      const outSum = outs.filter((r) => r.month.startsWith(prefix)).reduce((s, r) => s + r.quantity, 0);
      const upcomingSum = upcomingGroups.reduce((s, g) => s + (g.monthQty.get(m.iso) || 0), 0);
      b = b + inSum + upcomingSum - outSum;
      return b;
    });
  }, [opening, months, ins, outs, upcomingGroups]);

  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  async function add(direction: ForecastDirection) {
    if (!addLocationId) { onError('Pick a location to attach the row to.'); return; }
    const stamp = new Date().toISOString().slice(11, 19);
    const placeholder = `${direction === 'in' ? 'New supplier' : 'New customer'} (${stamp})`;
    try {
      await upsertForecast({
        productId: product.id, locationId: addLocationId,
        month: months[0].iso, direction, party: placeholder,
        quantity: 0, scenario,
      });
      await onReload();
    } catch (e) { onError(formatErr(e)); }
  }

  return (
    <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-slate-800/60 flex-wrap">
        <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{product.name}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">all locations · opening {opening.toLocaleString()} kg</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-gray-500 dark:text-gray-400">Add to:</span>
          <select value={addLocationId} onChange={(e) => setAddLocationId(e.target.value)}
            className="text-xs border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 rounded px-1.5 py-1">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
          </select>
          <button onClick={() => add('in')} className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white">+ IN row</button>
          <button onClick={() => add('out')} className="text-xs px-2 py-1 rounded bg-amber-700 hover:bg-amber-800 text-white">+ OUT row</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs min-w-full">
          <thead className="bg-gray-100/60 dark:bg-slate-800/30">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium text-gray-500 dark:text-gray-400 sticky left-0 bg-gray-100/60 dark:bg-slate-800/60 z-10 min-w-[220px]">Row</th>
              {months.map((m) => (
                <th key={m.iso} className="px-1.5 py-1.5 text-right font-medium text-gray-500 dark:text-gray-400 min-w-[56px]">{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {upcomingGroups.map((g) => {
              const loc = locById.get(g.locationId);
              return (
                <UpcomingSyntheticRow key={g.key} group={g} months={months}
                  locationChip={loc ? { code: loc.code, color: loc.color } : undefined} />
              );
            })}
            {inGroups.map((g) => {
              const loc = locById.get(g.locationId);
              return (
                <GroupedForecastRow key={g.key} group={g} months={months}
                  label={`IN · ${g.party || 'supplier'}`}
                  accent="bg-emerald-50/40 dark:bg-emerald-950/20"
                  locationChip={loc ? { code: loc.code, color: loc.color } : undefined}
                  onReload={onReload} onError={onError} />
              );
            })}
            {outGroups.map((g) => {
              const loc = locById.get(g.locationId);
              return (
                <GroupedForecastRow key={g.key} group={g} months={months}
                  label={`OUT · ${g.party || 'customer'}`}
                  accent="bg-amber-50/40 dark:bg-amber-950/20"
                  locationChip={loc ? { code: loc.code, color: loc.color } : undefined}
                  onReload={onReload} onError={onError} />
              );
            })}
            {(inGroups.length === 0 && outGroups.length === 0 && upcomingGroups.length === 0) && (
              <tr><td colSpan={months.length + 1} className="px-3 py-4 text-center text-gray-400 dark:text-gray-500 italic">No forecast rows yet — pick a location and click + IN row or + OUT row.</td></tr>
            )}
            <tr className="bg-gray-50 dark:bg-slate-800/40 font-semibold sticky bottom-0">
              <td className="px-2 py-1.5 text-gray-700 dark:text-gray-200 sticky left-0 bg-gray-100 dark:bg-slate-800 z-10">Balance (all locations)</td>
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

// Read-only IN row rendered from an upcoming stock lot. Same layout
// as GroupedForecastRow but with an amber "Upcoming" tag instead of
// the party input and no delete button — you edit the underlying lot
// from the Snapshot tab.
function UpcomingSyntheticRow({
  group, months, locationChip,
}: {
  group: UpcomingGroup;
  months: { iso: string; label: string }[];
  locationChip?: { code: string; color: string | null };
}) {
  return (
    <tr className="bg-amber-50/40 dark:bg-amber-950/20">
      <td className="px-2 py-1 sticky left-0 bg-inherit z-10 min-w-[220px]">
        <div className="flex items-center gap-1">
          {locationChip && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded bg-gray-200/70 dark:bg-slate-700/60 text-gray-700 dark:text-gray-200 flex-shrink-0">
              {locationChip.color && <span className="inline-block w-1.5 h-1.5 rounded-sm" style={{ backgroundColor: locationChip.color }} />}
              {locationChip.code}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">IN</span>
          <span
            className="flex-1 min-w-0 text-xs text-gray-800 dark:text-gray-100 truncate"
            title="Auto-populated from an Upcoming stock lot. Edit on the Current stock tab."
          >
            {group.manufacturer}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex-shrink-0"
            title="Sourced from Upcoming lots — read-only here"
          >
            upcoming
          </span>
        </div>
      </td>
      {months.map((m) => {
        const qty = group.monthQty.get(m.iso) || 0;
        const has = qty > 0;
        return (
          <td key={m.iso}
            className={`px-1.5 py-1 text-right ${has ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-gray-400 dark:text-gray-600'}`}
            title={has ? `${qty.toLocaleString()} kg landing this month (upcoming)` : undefined}
          >
            {has ? qty.toLocaleString() : '·'}
          </td>
        );
      })}
    </tr>
  );
}
