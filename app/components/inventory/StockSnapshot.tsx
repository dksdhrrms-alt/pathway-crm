'use client';

/**
 * StockSnapshot — Monday-board-style "what's in stock right now per
 * product × location" grid. Reads inventory_stock_lots, groups by
 * product (default) or location, and aggregates quantity per group.
 *
 * UX matches the rep's existing Monday workflow:
 *   • Group toggle (Product / Location) at the top
 *   • One inline-editable row per stock lot, with status chip
 *     (in_stock / upcoming) driving color
 *   • Sticky group header rows show the running total per group
 *   • "+ Add lot" button per group that pre-fills the group key,
 *     so adding inventory always starts close to where it lands
 *
 * Lives as its own component so the /inventory page route stays
 * small and the forecast view (next commit) can be a sibling.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Product, Location, StockLot, StockStatus,
  listProducts, listLocations, listStockLots,
  upsertStockLot, deleteStockLot,
} from '@/lib/inventory';

type GroupBy = 'product' | 'location';

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

const STATUS_CHIP: Record<StockStatus, string> = {
  in_stock: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  upcoming: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  sold:     'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-gray-300',
};
const STATUS_LABEL: Record<StockStatus, string> = {
  in_stock: 'In stock',
  upcoming: 'Upcoming',
  sold:     'Sold',
};

export default function StockSnapshot() {
  const [groupBy, setGroupBy] = useState<GroupBy>('product');
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [lots, setLots] = useState<StockLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, l, s] = await Promise.all([listProducts(), listLocations(), listStockLots()]);
      setProducts(p); setLocations(l); setLots(s);
    } catch (e) {
      setError(formatErr(e));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  // Group rows so the snapshot reads like the Monday board: outer
  // group (product OR location), then a flat list of lots inside.
  // `key` is the grouping entity's id, used to prefill new-lot rows.
  //
  // `total` is the actual landed stock (status='in_stock' only) — the
  // forecast opening balance and "what's available to ship" both rely
  // on this number being clean. `upcoming` is shown next to it so the
  // ops team can still see what's in transit without it inflating
  // current availability.
  type Group = { key: string; label: string; chipColor: string | null; lots: StockLot[]; total: number; upcoming: number };
  const groups: Group[] = useMemo(() => {
    const sumByStatus = (rows: StockLot[], target: StockStatus) =>
      rows.reduce((s, x) => x.status === target ? s + x.quantity : s, 0);
    if (groupBy === 'product') {
      return products.map((p) => {
        const groupLots = lots.filter((s) => s.productId === p.id);
        return {
          key: p.id,
          label: p.name,
          chipColor: null,
          lots: groupLots,
          total: sumByStatus(groupLots, 'in_stock'),
          upcoming: sumByStatus(groupLots, 'upcoming'),
        };
      });
    }
    return locations.map((l) => {
      const groupLots = lots.filter((s) => s.locationId === l.id);
      return {
        key: l.id,
        label: l.code,
        chipColor: l.color,
        lots: groupLots,
        total: sumByStatus(groupLots, 'in_stock'),
        upcoming: sumByStatus(groupLots, 'upcoming'),
      };
    });
  }, [groupBy, products, locations, lots]);

  async function handleSave(lot: StockLot) {
    try { await upsertStockLot(lot); await load(); }
    catch (e) { setError(formatErr(e)); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this stock lot?')) return;
    try { await deleteStockLot(id); await load(); }
    catch (e) { setError(formatErr(e)); }
  }

  if (loading) return <div className="py-12 text-center text-gray-500 dark:text-gray-400">Loading…</div>;

  if (products.length === 0 || locations.length === 0) {
    return (
      <div className="py-12 text-center text-gray-500 dark:text-gray-400">
        <p className="text-base font-medium text-gray-700 dark:text-gray-200 mb-1">
          Set up products and locations first
        </p>
        <p className="text-sm">
          Open <strong>Manage products / locations</strong> at the top right and add at least one of each.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Group-by toggle */}
      <div className="flex items-center justify-between">
        <div className="inline-flex bg-gray-100 dark:bg-slate-800 p-1 rounded-md">
          <button
            onClick={() => setGroupBy('product')}
            className={`px-3 py-1 text-sm rounded ${groupBy === 'product' ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400'}`}
          >By product</button>
          <button
            onClick={() => setGroupBy('location')}
            className={`px-3 py-1 text-sm rounded ${groupBy === 'location' ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400'}`}
          >By location</button>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Totals count In-stock only. Upcoming shown separately, Sold excluded.
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Groups */}
      <div className="space-y-4">
        {groups.map((g) => (
          <GroupTable
            key={g.key}
            group={g}
            groupBy={groupBy}
            products={products}
            locations={locations}
            productById={productById}
            locationById={locationById}
            onSave={handleSave}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}

function GroupTable({
  group, groupBy, products, locations, productById, locationById, onSave, onDelete,
}: {
  group: { key: string; label: string; chipColor: string | null; lots: StockLot[]; total: number; upcoming: number };
  groupBy: GroupBy;
  products: Product[];
  locations: Location[];
  productById: Map<string, Product>;
  locationById: Map<string, Location>;
  onSave: (lot: StockLot) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-slate-800/60">
        <div className="flex items-center gap-2">
          {group.chipColor && (
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: group.chipColor }} />
          )}
          <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{group.label}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{group.lots.length} lot{group.lots.length === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {group.total.toLocaleString()} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">kg</span>
          </span>
          {/* Upcoming is shown as a separate chip so it stays visible
              for planning without sneaking into the "available now"
              number. Only renders when > 0 to keep the header clean
              for groups with no in-transit lots. */}
          {group.upcoming > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" title="Lots marked Upcoming — not yet landed, excluded from the running total">
              +{group.upcoming.toLocaleString()} kg upcoming
            </span>
          )}
          <button
            onClick={() => setAdding(true)}
            disabled={products.length === 0 || locations.length === 0}
            title={products.length === 0 ? 'Add a product first in Manage products / locations' : (locations.length === 0 ? 'Add a location first' : 'Add a new stock lot')}
            className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >+ Add lot</button>
        </div>
      </div>

      {(group.lots.length === 0 && !adding) ? (
        <div className="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-500 italic">
          No lots yet — click + Add lot to register a PO / container.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-100/60 dark:bg-slate-800/30 text-[11px] uppercase text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium w-[14%]">Item</th>
              <th className="px-2 py-1.5 text-left font-medium w-[14%]">Manufacturer</th>
              <th className="px-2 py-1.5 text-right font-medium w-[8%]">Qty</th>
              <th className="px-2 py-1.5 text-left font-medium w-[12%]">Status</th>
              <th className="px-2 py-1.5 text-left font-medium w-[10%]">ETA</th>
              <th className="px-2 py-1.5 text-left font-medium w-[12%]">Container #</th>
              <th className="px-2 py-1.5 text-left font-medium w-[8%]">PO</th>
              <th className="px-2 py-1.5 text-left font-medium">Comment</th>
              <th className="px-2 py-1.5 w-12" />
            </tr>
          </thead>
          <tbody>
            {group.lots.map((lot) => (
              <LotRow
                key={lot.id}
                lot={lot}
                products={products}
                locations={locations}
                productById={productById}
                locationById={locationById}
                groupBy={groupBy}
                onSave={onSave}
                onDelete={onDelete}
              />
            ))}
            {adding && (
              <LotRow
                key="__new"
                lot={{
                  id: '',
                  productId: groupBy === 'product' ? group.key : (products[0]?.id || ''),
                  locationId: groupBy === 'location' ? group.key : (locations[0]?.id || ''),
                  manufacturer: '',
                  quantity: 0,
                  unit: 'kg',
                  status: 'in_stock',
                  etaDate: null,
                  containerNo: null,
                  poNumber: null,
                  comment: null,
                  createdBy: null,
                  createdAt: '',
                  updatedAt: '',
                }}
                products={products}
                locations={locations}
                productById={productById}
                locationById={locationById}
                groupBy={groupBy}
                isNew
                onSave={async (lot) => { await onSave(lot); setAdding(false); }}
                onDelete={async () => { setAdding(false); }}
              />
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LotRow({
  lot, products, locations, productById, locationById, groupBy, isNew, onSave, onDelete,
}: {
  lot: StockLot;
  products: Product[];
  locations: Location[];
  productById: Map<string, Product>;
  locationById: Map<string, Location>;
  groupBy: GroupBy;
  isNew?: boolean;
  onSave: (lot: StockLot) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<StockLot>(lot);
  const [saving, setSaving] = useState(false);
  // Dirty check ignores the auto-populated id/createdAt/updatedAt so
  // an unchanged row doesn't pretend to have unsaved edits.
  const dirty = isNew || JSON.stringify({ ...draft, id: '', createdAt: '', updatedAt: '' })
    !== JSON.stringify({ ...lot, id: '', createdAt: '', updatedAt: '' });

  async function save() {
    if (!draft.productId || !draft.locationId || !(draft.quantity > 0)) return;
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  }

  // When grouped by the OTHER axis (e.g. By Product, then opposing
  // axis is Location), show that axis as a dropdown so the rep can
  // move a lot between locations inline.
  const showProductPicker = groupBy === 'location';
  const showLocationPicker = groupBy === 'product';

  const productLabel = productById.get(draft.productId)?.name ?? '—';
  const location = locationById.get(draft.locationId);

  return (
    <tr className={isNew ? 'bg-emerald-50/50 dark:bg-emerald-950/30' : ''}>
      <td className="px-2 py-1.5">
        {showProductPicker ? (
          <select value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })}
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 rounded px-1.5 py-1 text-xs">
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : (
          <div className="flex items-center gap-1.5">
            {location?.color && <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: location.color }} />}
            {showLocationPicker ? (
              <select value={draft.locationId} onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 rounded px-1.5 py-1 text-xs">
                {locations.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
              </select>
            ) : (
              <span className="text-xs text-gray-700 dark:text-gray-200">{productLabel}</span>
            )}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5">
        <input value={draft.manufacturer || ''} onChange={(e) => setDraft({ ...draft, manufacturer: e.target.value })}
          placeholder="GNC Bioferm"
          className="w-full border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-1.5 py-1 text-xs focus:outline-none" />
      </td>
      <td className="px-2 py-1.5 text-right">
        <input type="number" min={0} value={draft.quantity || ''} onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) || 0 })}
          className="w-20 text-right border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-1.5 py-1 text-xs focus:outline-none" />
      </td>
      <td className="px-2 py-1.5">
        <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as StockStatus })}
          className={`w-full rounded px-1.5 py-1 text-xs font-medium ${STATUS_CHIP[draft.status]}`}>
          {(['in_stock', 'upcoming', 'sold'] as StockStatus[]).map((s) =>
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          )}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input type="date" value={draft.etaDate || ''} onChange={(e) => setDraft({ ...draft, etaDate: e.target.value || null })}
          className="w-full border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-1.5 py-1 text-xs focus:outline-none" />
      </td>
      <td className="px-2 py-1.5">
        <input value={draft.containerNo || ''} onChange={(e) => setDraft({ ...draft, containerNo: e.target.value || null })}
          placeholder="GAOU…"
          className="w-full border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-1.5 py-1 text-xs focus:outline-none" />
      </td>
      <td className="px-2 py-1.5">
        <input value={draft.poNumber || ''} onChange={(e) => setDraft({ ...draft, poNumber: e.target.value || null })}
          placeholder="PO #"
          className="w-full border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-1.5 py-1 text-xs focus:outline-none" />
      </td>
      <td className="px-2 py-1.5">
        <input value={draft.comment || ''} onChange={(e) => setDraft({ ...draft, comment: e.target.value || null })}
          className="w-full border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-1.5 py-1 text-xs focus:outline-none" />
      </td>
      <td className="px-2 py-1.5 flex items-center gap-1 justify-end">
        {dirty && (
          <button onClick={save} disabled={saving || !draft.productId || !draft.locationId || !(draft.quantity > 0)}
            className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50">
            {saving ? '…' : 'Save'}
          </button>
        )}
        <button onClick={() => onDelete(lot.id)}
          className="text-xs px-1.5 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          title="Delete">×</button>
      </td>
    </tr>
  );
}
