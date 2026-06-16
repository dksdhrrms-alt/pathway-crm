/**
 * Inventory data layer — typed wrappers around the four tables
 * created in data-migration/20-inventory.sql.
 *
 * Kept separate from lib/db.ts to avoid touching that already-huge
 * file (which has been the truncation hotspot). Pages import from
 * here directly.
 */

import { createClient } from '@supabase/supabase-js';

// ─── Browser-side Supabase client ────────────────────────────────
// The inventory area is admin-only, so we can use the public anon
// key with row-level security. The existing CRM client wiring is
// reused; we don't open a second connection per request — Supabase
// pools internally.
function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Types ───────────────────────────────────────────────────────
export interface Product {
  id: string;
  name: string;
  sku: string | null;
  unit: string;          // typically 'pallet'
  costPerUnit: number | null;
  displayOrder: number;
  active: boolean;
}

export interface Location {
  id: string;
  code: string;          // 'IA (BVS)', 'StormLake', 'MN'...
  name: string;          // full name for display
  color: string | null;  // hex, drives chip color on grid
  displayOrder: number;
  active: boolean;
}

export type StockStatus = 'in_stock' | 'upcoming' | 'sold';

export interface StockLot {
  id: string;
  productId: string;
  locationId: string;
  manufacturer: string | null;
  quantity: number;
  unit: string;
  status: StockStatus;
  etaDate: string | null;     // ISO date
  containerNo: string | null;
  poNumber: string | null;
  comment: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ForecastDirection = 'in' | 'out';
export type ForecastScenario = 'best' | 'worst' | 'expected';

export interface ForecastRow {
  id: string;
  productId: string;
  locationId: string;
  month: string;          // ISO date (first of month)
  direction: ForecastDirection;
  party: string | null;
  quantity: number;
  scenario: ForecastScenario;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Row mappers ─────────────────────────────────────────────────
// Supabase returns snake_case from the DB; map to camelCase domain
// objects here so callers don't have to think about it.
type ProductRow = { id: string; name: string; sku: string | null; unit: string;
  cost_per_unit: number | string | null; display_order: number; active: boolean };
type LocationRow = { id: string; code: string; name: string; color: string | null;
  display_order: number; active: boolean };
type StockLotRow = { id: string; product_id: string; location_id: string;
  manufacturer: string | null; quantity: number | string; unit: string;
  status: StockStatus; eta_date: string | null; container_no: string | null;
  po_number: string | null; comment: string | null; created_by: string | null;
  created_at: string; updated_at: string };
type ForecastRowRaw = { id: string; product_id: string; location_id: string;
  month: string; direction: ForecastDirection; party: string | null;
  quantity: number | string; scenario: ForecastScenario; note: string | null;
  created_by: string | null; created_at: string; updated_at: string };

function asProduct(r: ProductRow): Product {
  return {
    id: r.id, name: r.name, sku: r.sku, unit: r.unit,
    costPerUnit: r.cost_per_unit == null ? null : Number(r.cost_per_unit),
    displayOrder: r.display_order, active: r.active,
  };
}
function asLocation(r: LocationRow): Location {
  return {
    id: r.id, code: r.code, name: r.name, color: r.color,
    displayOrder: r.display_order, active: r.active,
  };
}
function asStockLot(r: StockLotRow): StockLot {
  return {
    id: r.id, productId: r.product_id, locationId: r.location_id,
    manufacturer: r.manufacturer, quantity: Number(r.quantity), unit: r.unit,
    status: r.status, etaDate: r.eta_date, containerNo: r.container_no,
    poNumber: r.po_number, comment: r.comment, createdBy: r.created_by,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function asForecast(r: ForecastRowRaw): ForecastRow {
  return {
    id: r.id, productId: r.product_id, locationId: r.location_id,
    month: r.month, direction: r.direction, party: r.party,
    quantity: Number(r.quantity), scenario: r.scenario, note: r.note,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ─── Products ────────────────────────────────────────────────────
export async function listProducts(): Promise<Product[]> {
  const { data, error } = await sb()
    .from('inventory_products')
    .select('*')
    .order('display_order')
    .order('name');
  if (error) throw error;
  return (data as ProductRow[]).map(asProduct);
}
export async function upsertProduct(p: Partial<Product> & { name: string }): Promise<Product> {
  const payload = {
    id: p.id, name: p.name.trim(), sku: p.sku || null, unit: p.unit || 'pallet',
    cost_per_unit: p.costPerUnit ?? null,
    display_order: p.displayOrder ?? 0, active: p.active ?? true,
  };
  const { data, error } = await sb()
    .from('inventory_products').upsert(payload).select('*').single();
  if (error) throw error;
  return asProduct(data as ProductRow);
}
export async function deleteProduct(id: string): Promise<void> {
  const { error } = await sb().from('inventory_products').delete().eq('id', id);
  if (error) throw error;
}

// ─── Locations ───────────────────────────────────────────────────
export async function listLocations(): Promise<Location[]> {
  const { data, error } = await sb()
    .from('inventory_locations')
    .select('*')
    .order('display_order')
    .order('code');
  if (error) throw error;
  return (data as LocationRow[]).map(asLocation);
}
export async function upsertLocation(l: Partial<Location> & { code: string; name: string }): Promise<Location> {
  const payload = {
    id: l.id, code: l.code.trim(), name: l.name.trim(),
    color: l.color || null,
    display_order: l.displayOrder ?? 0, active: l.active ?? true,
  };
  const { data, error } = await sb()
    .from('inventory_locations').upsert(payload).select('*').single();
  if (error) throw error;
  return asLocation(data as LocationRow);
}
export async function deleteLocation(id: string): Promise<void> {
  const { error } = await sb().from('inventory_locations').delete().eq('id', id);
  if (error) throw error;
}

// ─── Stock lots ──────────────────────────────────────────────────
export async function listStockLots(): Promise<StockLot[]> {
  const { data, error } = await sb()
    .from('inventory_stock_lots')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as StockLotRow[]).map(asStockLot);
}
export async function upsertStockLot(s: Partial<StockLot> & { productId: string; locationId: string; quantity: number }): Promise<StockLot> {
  const payload = {
    id: s.id, product_id: s.productId, location_id: s.locationId,
    manufacturer: s.manufacturer || null, quantity: s.quantity,
    unit: s.unit || 'pallet', status: s.status || 'in_stock',
    eta_date: s.etaDate || null, container_no: s.containerNo || null,
    po_number: s.poNumber || null, comment: s.comment || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb()
    .from('inventory_stock_lots').upsert(payload).select('*').single();
  if (error) throw error;
  return asStockLot(data as StockLotRow);
}
export async function deleteStockLot(id: string): Promise<void> {
  const { error } = await sb().from('inventory_stock_lots').delete().eq('id', id);
  if (error) throw error;
}

// ─── Forecasts ───────────────────────────────────────────────────
export async function listForecasts(): Promise<ForecastRow[]> {
  const { data, error } = await sb()
    .from('inventory_forecasts')
    .select('*')
    .order('month');
  if (error) throw error;
  return (data as ForecastRowRaw[]).map(asForecast);
}
export async function upsertForecast(f: Partial<ForecastRow> & { productId: string; locationId: string; month: string; direction: ForecastDirection; quantity: number }): Promise<ForecastRow> {
  const payload = {
    id: f.id, product_id: f.productId, location_id: f.locationId,
    month: f.month, direction: f.direction, party: f.party || null,
    quantity: f.quantity, scenario: f.scenario || 'expected',
    note: f.note || null, updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb()
    .from('inventory_forecasts').upsert(payload).select('*').single();
  if (error) throw error;
  return asForecast(data as ForecastRowRaw);
}
export async function deleteForecast(id: string): Promise<void> {
  const { error } = await sb().from('inventory_forecasts').delete().eq('id', id);
  if (error) throw error;
}
