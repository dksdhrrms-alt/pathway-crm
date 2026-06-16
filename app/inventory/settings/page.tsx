'use client';

/**
 * Inventory Settings — manage the Products and Locations dimensions
 * that the rest of the Inventory module hangs off. Same admin gate
 * as the main /inventory page.
 *
 * Single page with two side-by-side cards:
 *   • Products  (name / sku / unit / cost-per-unit)
 *   • Locations (code / full name / color chip)
 *
 * Both lists render inline-editable rows + an "+ Add" row at the
 * top. No modals — the page is operations-team territory and they'll
 * be in here clicking through a list, not pulled into a dialog
 * workflow.
 */

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import TopBar from '@/app/components/TopBar';
import {
  Product, Location,
  listProducts, upsertProduct, deleteProduct,
  listLocations, upsertLocation, deleteLocation,
} from '@/lib/inventory';

const ALLOWED_ROLES = ['admin', 'administrative_manager', 'ceo', 'coo'];

// Supabase errors are plain objects ({message, code, details, hint}),
// not Error instances. Pulling `.message` off is what gives the rep an
// actually-useful string instead of "[object Object]".
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

// Reasonable defaults to seed the color picker with — mirrors the
// chip palette the Monday board was using.
const LOCATION_COLOR_PRESETS = [
  '#fb923c', '#22c55e', '#3b82f6', '#a855f7', '#ec4899',
  '#facc15', '#06b6d4', '#ef4444', '#64748b', '#84cc16',
];

export default function InventorySettingsPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const allowed = ALLOWED_ROLES.includes(role);

  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Load
  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, l] = await Promise.all([listProducts(), listLocations()]);
      setProducts(p); setLocations(l);
    } catch (e) {
      setError(formatErr(e));
    } finally { setLoading(false); }
  }
  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
        <TopBar placeholder="Search CRM..." />
        <main className="pt-16 px-6 pb-10">
          <div className="max-w-3xl mx-auto mt-12 text-center text-gray-600 dark:text-gray-400">
            <h1 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">Access denied</h1>
            <Link href="/dashboard" className="text-emerald-700 dark:text-emerald-400 hover:underline">← Back to Home</Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar placeholder="Search CRM..." />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-6xl mx-auto">
          <div className="mt-6 mb-5 flex items-center justify-between">
            <div>
              <Link href="/inventory" className="text-sm text-emerald-700 dark:text-emerald-400 hover:underline">← Inventory</Link>
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">Settings</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage the product catalog and warehouse locations the inventory grid runs off.</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ProductsCard
              loading={loading}
              products={products}
              onChange={load}
              onError={setError}
            />
            <LocationsCard
              loading={loading}
              locations={locations}
              onChange={load}
              onError={setError}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Products card ─────────────────────────────────────────────────
function ProductsCard({
  loading, products, onChange, onError,
}: {
  loading: boolean;
  products: Product[];
  onChange: () => void | Promise<void>;
  onError: (e: string) => void;
}) {
  const [draftName, setDraftName] = useState('');
  const [draftSku, setDraftSku] = useState('');
  const [draftUnit, setDraftUnit] = useState('kg');
  const [draftCost, setDraftCost] = useState('');

  async function add() {
    if (!draftName.trim()) return;
    try {
      await upsertProduct({
        name: draftName.trim(),
        sku: draftSku.trim() || null,
        unit: draftUnit.trim() || 'kg',
        costPerUnit: draftCost ? Number(draftCost) : null,
        displayOrder: products.length,
        active: true,
      });
      setDraftName(''); setDraftSku(''); setDraftCost('');
      await onChange();
    } catch (e) { onError(formatErr(e)); }
  }

  async function save(p: Product) {
    try { await upsertProduct(p); await onChange(); }
    catch (e) { onError(formatErr(e)); }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete product "${name}"? Existing stock lots / forecast rows referencing it will block this if any exist.`)) return;
    try { await deleteProduct(id); await onChange(); }
    catch (e) { onError(formatErr(e)); }
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">Products</h2>

      {/* Add row */}
      <div className="grid grid-cols-12 gap-2 mb-3">
        <input
          value={draftName} onChange={(e) => setDraftName(e.target.value)}
          placeholder="Product name *"
          className="col-span-5 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <input
          value={draftSku} onChange={(e) => setDraftSku(e.target.value)}
          placeholder="SKU"
          className="col-span-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <input
          value={draftUnit} onChange={(e) => setDraftUnit(e.target.value)}
          placeholder="unit"
          className="col-span-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <input
          value={draftCost} onChange={(e) => setDraftCost(e.target.value)}
          placeholder="$/unit" type="number" min={0}
          className="col-span-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          onClick={add} disabled={!draftName.trim()}
          className="col-span-1 px-2 py-1.5 text-sm rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-medium disabled:opacity-50"
        >Add</button>
      </div>

      {loading && <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>}

      {!loading && products.length === 0 && (
        <div className="text-sm text-gray-400 dark:text-gray-500 italic py-6 text-center">No products yet — add Lipidol Ultra, EndoPower Green, etc. above.</div>
      )}

      <ul className="divide-y divide-gray-100 dark:divide-slate-800">
        {products.map((p) => (
          <ProductRow key={p.id} product={p} onSave={save} onDelete={remove} />
        ))}
      </ul>
    </div>
  );
}

function ProductRow({ product, onSave, onDelete }: {
  product: Product;
  onSave: (p: Product) => Promise<void>;
  onDelete: (id: string, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku || '');
  const [unit, setUnit] = useState(product.unit);
  const [cost, setCost] = useState(product.costPerUnit?.toString() || '');
  const dirty = name !== product.name || sku !== (product.sku || '') ||
                unit !== product.unit || cost !== (product.costPerUnit?.toString() || '');
  return (
    <li className="grid grid-cols-12 gap-2 py-2 items-center">
      <input value={name} onChange={(e) => setName(e.target.value)}
        className="col-span-5 border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-2 py-1 text-sm focus:outline-none" />
      <input value={sku} onChange={(e) => setSku(e.target.value)}
        className="col-span-2 border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-2 py-1 text-sm focus:outline-none" />
      <input value={unit} onChange={(e) => setUnit(e.target.value)}
        className="col-span-2 border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-2 py-1 text-sm focus:outline-none" />
      <input value={cost} onChange={(e) => setCost(e.target.value)} type="number" min={0}
        className="col-span-2 border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-2 py-1 text-sm focus:outline-none" />
      <div className="col-span-1 flex items-center gap-1 justify-end">
        {dirty && (
          <button
            onClick={() => onSave({ ...product, name, sku: sku || null, unit, costPerUnit: cost ? Number(cost) : null })}
            className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white"
          >Save</button>
        )}
        <button onClick={() => onDelete(product.id, product.name)}
          className="text-xs px-1.5 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          title="Delete">×</button>
      </div>
    </li>
  );
}

// ─── Locations card ────────────────────────────────────────────────
function LocationsCard({
  loading, locations, onChange, onError,
}: {
  loading: boolean;
  locations: Location[];
  onChange: () => void | Promise<void>;
  onError: (e: string) => void;
}) {
  const [draftCode, setDraftCode] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState(LOCATION_COLOR_PRESETS[0]);

  async function add() {
    if (!draftCode.trim() || !draftName.trim()) return;
    try {
      await upsertLocation({
        code: draftCode.trim(),
        name: draftName.trim(),
        color: draftColor,
        displayOrder: locations.length,
        active: true,
      });
      setDraftCode(''); setDraftName('');
      await onChange();
    } catch (e) { onError(formatErr(e)); }
  }

  async function save(l: Location) {
    try { await upsertLocation(l); await onChange(); }
    catch (e) { onError(formatErr(e)); }
  }

  async function remove(id: string, code: string) {
    if (!confirm(`Delete location "${code}"? Existing stock lots / forecast rows referencing it will block this if any exist.`)) return;
    try { await deleteLocation(id); await onChange(); }
    catch (e) { onError(formatErr(e)); }
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">Locations</h2>

      <div className="grid grid-cols-12 gap-2 mb-3">
        <input
          value={draftCode} onChange={(e) => setDraftCode(e.target.value)}
          placeholder="Code (e.g. IA-BVS) *"
          className="col-span-4 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <input
          value={draftName} onChange={(e) => setDraftName(e.target.value)}
          placeholder="Full name *"
          className="col-span-5 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <ColorSwatchPicker value={draftColor} onChange={setDraftColor} className="col-span-2" />
        <button
          onClick={add} disabled={!draftCode.trim() || !draftName.trim()}
          className="col-span-1 px-2 py-1.5 text-sm rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-medium disabled:opacity-50"
        >Add</button>
      </div>

      {loading && <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>}

      {!loading && locations.length === 0 && (
        <div className="text-sm text-gray-400 dark:text-gray-500 italic py-6 text-center">No locations yet — add MN, PA, IA-BVS, StormLake, etc.</div>
      )}

      <ul className="divide-y divide-gray-100 dark:divide-slate-800">
        {locations.map((l) => (
          <LocationRow key={l.id} location={l} onSave={save} onDelete={remove} />
        ))}
      </ul>
    </div>
  );
}

function LocationRow({ location, onSave, onDelete }: {
  location: Location;
  onSave: (l: Location) => Promise<void>;
  onDelete: (id: string, code: string) => Promise<void>;
}) {
  const [code, setCode] = useState(location.code);
  const [name, setName] = useState(location.name);
  const [color, setColor] = useState(location.color || LOCATION_COLOR_PRESETS[0]);
  const dirty = code !== location.code || name !== location.name || color !== (location.color || '');
  return (
    <li className="grid grid-cols-12 gap-2 py-2 items-center">
      <input value={code} onChange={(e) => setCode(e.target.value)}
        className="col-span-4 border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-2 py-1 text-sm focus:outline-none" />
      <input value={name} onChange={(e) => setName(e.target.value)}
        className="col-span-5 border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-emerald-500 dark:bg-slate-900 dark:text-gray-100 rounded px-2 py-1 text-sm focus:outline-none" />
      <ColorSwatchPicker value={color} onChange={setColor} className="col-span-2" />
      <div className="col-span-1 flex items-center gap-1 justify-end">
        {dirty && (
          <button
            onClick={() => onSave({ ...location, code, name, color })}
            className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white"
          >Save</button>
        )}
        <button onClick={() => onDelete(location.id, location.code)}
          className="text-xs px-1.5 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          title="Delete">×</button>
      </div>
    </li>
  );
}

// Color picker — clickable swatch palette in a popover plus a hex
// input fallback. Click the preview square to open the palette;
// click a swatch to apply. Closes on outside click.
function ColorSwatchPicker({ value, onChange, className }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div ref={ref} className={`relative flex items-center gap-1 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-block w-5 h-5 rounded border border-gray-300 dark:border-slate-600 flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-emerald-400 transition"
        style={{ backgroundColor: value }}
        title="Pick a color"
        aria-label="Pick a color"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-1.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
        title="Hex color"
      />
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-md shadow-lg p-2">
          <div className="grid grid-cols-5 gap-1.5">
            {LOCATION_COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false); }}
                className={`w-6 h-6 rounded border ${value.toLowerCase() === c.toLowerCase() ? 'border-gray-900 dark:border-white ring-2 ring-emerald-400' : 'border-gray-300 dark:border-slate-600'} hover:scale-110 transition`}
                style={{ backgroundColor: c }}
                title={c}
                aria-label={c}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
