/**
 * Product catalog — CRUD wrapper for the product_library_products +
 * product_library_files tables (data-migration/25-product-catalog.sql).
 *
 * Consumers
 *  - Sidebar renders the top-level product list (read-only).
 *  - `/products/[slug]` renders the full catalog page for one product.
 *  - Admin → Product Library edits everything.
 *
 * Kept in its own file (not lib/db.ts) to avoid touching the huge
 * db.ts hot spot, mirroring lib/inventory.ts and lib/productLinks.ts.
 */

import { createClient } from '@supabase/supabase-js';

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Types ─────────────────────────────────────────────────────────

export type FileCategory =
  | 'presentation'
  | 'flyer'
  | 'calculator'
  | 'technical_bulletin'
  | 'document';

/** Order + display labels for the Sales Tools sections. */
export const FILE_CATEGORY_META: { key: FileCategory; label: string; emoji: string }[] = [
  { key: 'presentation',       label: 'Sales presentations', emoji: '🎬' },
  { key: 'flyer',              label: 'Flyers',              emoji: '📄' },
  { key: 'calculator',         label: 'Calculators',         emoji: '🧮' },
  { key: 'technical_bulletin', label: 'Technical bulletins', emoji: '📊' },
  { key: 'document',           label: 'Documents',           emoji: '📁' },
];

export interface ProductInfoRow {
  label: string;
  values: string[]; // aligned to `columns` length
}
export interface ProductInfo {
  columns: string[]; // e.g. ['Imperial', 'Metric'] or ['Metric']
  rows: ProductInfoRow[];
}

export interface ProductFile {
  id: string;
  productId: string;
  category: FileCategory;
  label: string;
  url: string;
  /** Optional preview image shown above the filename on the catalog page. */
  thumbnailUrl: string | null;
  displayOrder: number;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  productInfo: ProductInfo;
  displayOrder: number;
  active: boolean;
  files: ProductFile[];      // populated by getProduct()/listProductsWithFiles()
}

// ── Row shapes (snake_case from Supabase) ────────────────────────

type ProductRow = {
  id: string; slug: string; name: string;
  tagline: string | null; description: string | null;
  product_info: unknown; display_order: number; active: boolean;
};
type FileRow = {
  id: string; product_id: string; category: FileCategory;
  label: string; url: string; thumbnail_url: string | null;
  display_order: number;
};

function asProductInfo(raw: unknown): ProductInfo {
  const def: ProductInfo = { columns: [], rows: [] };
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as { columns?: unknown; rows?: unknown };
  const cols = Array.isArray(r.columns) ? r.columns.map(String) : [];
  const rows = Array.isArray(r.rows)
    ? r.rows.filter((x): x is ProductInfoRow => !!x && typeof x === 'object')
        .map((x) => {
          const o = x as { label?: unknown; values?: unknown };
          return {
            label: String(o.label || ''),
            values: Array.isArray(o.values) ? o.values.map(String) : [],
          };
        })
    : [];
  return { columns: cols, rows };
}

function asProduct(r: ProductRow, files: ProductFile[] = []): Product {
  return {
    id: r.id, slug: r.slug, name: r.name,
    tagline: r.tagline, description: r.description,
    productInfo: asProductInfo(r.product_info),
    displayOrder: r.display_order, active: r.active,
    files,
  };
}

function asFile(r: FileRow): ProductFile {
  return {
    id: r.id, productId: r.product_id, category: r.category,
    label: r.label, url: r.url,
    thumbnailUrl: r.thumbnail_url,
    displayOrder: r.display_order,
  };
}

// ── Reads ────────────────────────────────────────────────────────

/** Sidebar / product list — no files loaded, keeps payload light. */
export async function listProducts(): Promise<Product[]> {
  const { data, error } = await sb()
    .from('product_library_products')
    .select('*')
    .order('display_order').order('name');
  if (error) throw error;
  return (data as ProductRow[]).map((r) => asProduct(r));
}

/** Admin panel + individual catalog pages — everything joined. */
export async function listProductsWithFiles(): Promise<Product[]> {
  const [p, f] = await Promise.all([
    sb().from('product_library_products').select('*').order('display_order').order('name'),
    sb().from('product_library_files').select('*').order('display_order').order('label'),
  ]);
  if (p.error) throw p.error;
  if (f.error) throw f.error;
  const byProduct = new Map<string, ProductFile[]>();
  for (const row of f.data as FileRow[]) {
    const arr = byProduct.get(row.product_id) || [];
    arr.push(asFile(row));
    byProduct.set(row.product_id, arr);
  }
  return (p.data as ProductRow[]).map((r) => asProduct(r, byProduct.get(r.id) || []));
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const { data, error } = await sb()
    .from('product_library_products').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: files } = await sb()
    .from('product_library_files').select('*').eq('product_id', (data as ProductRow).id)
    .order('display_order').order('label');
  return asProduct(data as ProductRow, ((files || []) as FileRow[]).map(asFile));
}

// ── Writes ───────────────────────────────────────────────────────

export async function upsertProduct(
  input: Partial<Product> & { slug: string; name: string },
): Promise<Product> {
  // Postgres uuid columns reject '' — mirror the inventory pattern
  // and only include `id` when we actually have one.
  const payload: Record<string, unknown> = {
    slug: input.slug.trim(),
    name: input.name.trim(),
    tagline: input.tagline || null,
    description: input.description || null,
    product_info: input.productInfo ?? { columns: [], rows: [] },
    display_order: input.displayOrder ?? 0,
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };
  if (input.id) payload.id = input.id;
  const { data, error } = await sb()
    .from('product_library_products').upsert(payload).select('*').single();
  if (error) throw error;
  return asProduct(data as ProductRow);
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await sb().from('product_library_products').delete().eq('id', id);
  if (error) throw error;
}

export async function upsertFile(
  input: Partial<ProductFile> & { productId: string; category: FileCategory; label: string; url: string },
): Promise<ProductFile> {
  const payload: Record<string, unknown> = {
    product_id: input.productId,
    category: input.category,
    label: input.label.trim(),
    url: input.url.trim(),
    thumbnail_url: input.thumbnailUrl ? String(input.thumbnailUrl).trim() : null,
    display_order: input.displayOrder ?? 0,
    updated_at: new Date().toISOString(),
  };
  if (input.id) payload.id = input.id;
  const { data, error } = await sb()
    .from('product_library_files').upsert(payload).select('*').single();
  if (error) throw error;
  return asFile(data as FileRow);
}

export async function deleteFile(id: string): Promise<void> {
  const { error } = await sb().from('product_library_files').delete().eq('id', id);
  if (error) throw error;
}

/** Turn a display name into a URL-safe slug. */
export function toSlug(name: string): string {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
