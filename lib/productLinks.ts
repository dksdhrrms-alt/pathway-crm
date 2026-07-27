/**
 * Product Library links — CRUD wrapper for the
 * product_library_links table (data-migration/23-product-library-links.sql).
 *
 * Two consumers:
 *  - Sidebar (read-only) renders these as sub-items under the
 *    "Products" expandable group. Auto-refreshes on realtime insert /
 *    update / delete so admin edits show up without a page reload.
 *  - Admin → Product Library (CRUD) — create / rename / re-URL /
 *    reorder / delete.
 *
 * Kept separate from lib/db.ts to avoid touching that already-huge
 * file (the recurring truncation hotspot); mirrors the inventory
 * data-layer pattern (lib/inventory.ts).
 */

import { createClient } from '@supabase/supabase-js';

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface ProductLink {
  id: string;
  label: string;
  url: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

type Row = {
  id: string;
  label: string;
  url: string;
  display_order: number;
  created_at: string;
  updated_at: string;
};

function asLink(r: Row): ProductLink {
  return {
    id: r.id,
    label: r.label,
    url: r.url,
    displayOrder: r.display_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listProductLinks(): Promise<ProductLink[]> {
  const { data, error } = await sb()
    .from('product_library_links')
    .select('*')
    .order('display_order')
    .order('label');
  if (error) throw error;
  return (data as Row[]).map(asLink);
}

export async function upsertProductLink(
  input: Partial<ProductLink> & { label: string; url: string },
): Promise<ProductLink> {
  // Postgres uuid columns reject "" (syntax 22P02) — only pass id
  // through when we actually have one, so gen_random_uuid() fires
  // on inserts.
  const payload: Record<string, unknown> = {
    label: input.label.trim(),
    url: input.url.trim(),
    display_order: input.displayOrder ?? 0,
    updated_at: new Date().toISOString(),
  };
  if (input.id) payload.id = input.id;
  const { data, error } = await sb()
    .from('product_library_links')
    .upsert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return asLink(data as Row);
}

export async function deleteProductLink(id: string): Promise<void> {
  const { error } = await sb().from('product_library_links').delete().eq('id', id);
  if (error) throw error;
}
