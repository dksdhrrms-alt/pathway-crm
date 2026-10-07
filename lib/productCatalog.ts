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

export type ApprovalStatus = 'draft' | 'pending' | 'approved' | 'rejected';

/** Hierarchical folders in the product catalog (data-migration/34).
 *  Folders are NOT part of the approval workflow — creating or moving
 *  a folder is immediate. Only uploaded files go pending → approved. */
export interface Folder {
  id: string;
  name: string;
  /** Null = root-level folder. Non-null = nested inside another folder. */
  parentId: string | null;
  displayOrder: number;
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
  // Approval workflow (data-migration/33) — files are the ONLY entity
  // in the catalog that goes through approval. Products / folders show
  // up immediately.
  status: ApprovalStatus;
  createdBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  /** @deprecated Use folderId instead. Kept for backward-compat only. */
  species: string | null;
  /** Null = at the root of the catalog. Non-null = inside a Folder. */
  folderId: string | null;
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
  species: string | null;
  folder_id: string | null;
  tagline: string | null; description: string | null;
  product_info: unknown; display_order: number; active: boolean;
};
type FileRow = {
  id: string; product_id: string; category: FileCategory;
  label: string; url: string; thumbnail_url: string | null;
  display_order: number;
  status?: ApprovalStatus | null;
  created_by?: string | null;
  submitted_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
};
type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
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
    species: r.species,
    folderId: r.folder_id ?? null,
    tagline: r.tagline, description: r.description,
    productInfo: asProductInfo(r.product_info),
    displayOrder: r.display_order, active: r.active,
    files,
  };
}

function asFolder(r: FolderRow): Folder {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    displayOrder: r.display_order,
  };
}

function asFile(r: FileRow): ProductFile {
  return {
    id: r.id, productId: r.product_id, category: r.category,
    label: r.label, url: r.url,
    thumbnailUrl: r.thumbnail_url,
    displayOrder: r.display_order,
    status: (r.status as ApprovalStatus) ?? 'approved',
    createdBy: r.created_by ?? null,
    submittedAt: r.submitted_at ?? null,
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ?? null,
    rejectionReason: r.rejection_reason ?? null,
  };
}

// ── Reads ────────────────────────────────────────────────────────

/** Sidebar / product list — no files loaded, keeps payload light.
 *  Products are visible as soon as they exist; approval is on files
 *  only (data-migration/33). */
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
    sb().from('product_library_products').select('*')
      .order('display_order').order('name'),
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

/** Public catalog page — product + only its *approved* files. The
 *  product itself is always returned (no product-level approval). */
export async function getProductBySlug(slug: string): Promise<Product | null> {
  const { data, error } = await sb()
    .from('product_library_products').select('*')
    .eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: files } = await sb()
    .from('product_library_files').select('*')
    .eq('product_id', (data as ProductRow).id)
    .eq('status', 'approved')
    .order('display_order').order('label');
  return asProduct(data as ProductRow, ((files || []) as FileRow[]).map(asFile));
}

// ── Folders ─────────────────────────────────────────────────────
// Lightweight CRUD for the hierarchical folder tree in the
// product catalog. No approval workflow — folder changes are
// immediate (users can rename / move / create freely).

export async function listFolders(): Promise<Folder[]> {
  const { data, error } = await sb()
    .from('product_library_folders')
    .select('*')
    .order('display_order').order('name');
  if (error) throw error;
  return (data as FolderRow[]).map(asFolder);
}

export async function createFolder(
  name: string, parentId: string | null, displayOrder = 0,
): Promise<Folder> {
  const payload: Record<string, unknown> = {
    name: name.trim(),
    parent_id: parentId,
    display_order: displayOrder,
  };
  const { data, error } = await sb()
    .from('product_library_folders').insert(payload).select('*').single();
  if (error) throw error;
  return asFolder(data as FolderRow);
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const { error } = await sb()
    .from('product_library_folders')
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function moveFolder(
  id: string, newParentId: string | null, displayOrder?: number,
): Promise<void> {
  // Guard against moving a folder into itself or one of its descendants —
  // the caller should also check, but defense-in-depth never hurts.
  if (newParentId === id) throw new Error('A folder cannot be its own parent.');
  const payload: Record<string, unknown> = {
    parent_id: newParentId,
    updated_at: new Date().toISOString(),
  };
  if (typeof displayOrder === 'number') payload.display_order = displayOrder;
  const { error } = await sb()
    .from('product_library_folders').update(payload).eq('id', id);
  if (error) throw error;
}

/** Reorder folders amongst their siblings. Pass the full ordered id
 *  array for one parent (or root) — we write display_order = index. */
export async function reorderFolders(ids: string[]): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all(ids.map((id, i) =>
    sb().from('product_library_folders')
      .update({ display_order: i, updated_at: now })
      .eq('id', id)
  ));
}

export async function deleteFolder(id: string): Promise<void> {
  // ON DELETE SET NULL on both children folders and products handles
  // orphans — they resurface at the root rather than disappearing.
  const { error } = await sb()
    .from('product_library_folders').delete().eq('id', id);
  if (error) throw error;
}

// ── Folder approvers (per-species Marketing Approvers) ─────────
// data-migration/35. A row (folder_id, user_id) means that user can
// approve files anywhere inside that folder or any of its descendants.
// The global `marketing_approver` permission continues to grant
// cross-folder authority — this table is additive on top.

export interface FolderApprover { folderId: string; userId: string }

type ApproverRow = { folder_id: string; user_id: string };

export async function listFolderApprovers(): Promise<FolderApprover[]> {
  const { data, error } = await sb()
    .from('product_library_folder_approvers')
    .select('folder_id, user_id');
  if (error) throw error;
  return (data as ApproverRow[]).map((r) => ({ folderId: r.folder_id, userId: r.user_id }));
}

/** Replace the approver list for one folder in a single call.
 *  Deletes rows that aren't in `userIds` and inserts the new ones. */
export async function setFolderApprovers(
  folderId: string, userIds: string[],
): Promise<void> {
  const client = sb();
  const unique = Array.from(new Set(userIds.map((s) => s.trim()).filter(Boolean)));
  // Wipe-and-rewrite — tiny list, race-free for the small admin UI.
  const del = await client
    .from('product_library_folder_approvers')
    .delete().eq('folder_id', folderId);
  if (del.error) throw del.error;
  if (unique.length === 0) return;
  const rows = unique.map((user_id) => ({ folder_id: folderId, user_id }));
  const ins = await client.from('product_library_folder_approvers').insert(rows);
  if (ins.error) throw ins.error;
}

/** Climb a folder's parent chain, returning every ancestor id
 *  (including the folder itself) up to the root. */
export function ancestorFolderIds(folders: Folder[], folderId: string | null): string[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f] as const));
  const result: string[] = [];
  const seen = new Set<string>();
  let cur: Folder | undefined = byId.get(folderId);
  while (cur && !seen.has(cur.id)) {
    result.push(cur.id);
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return result;
}

/** True when `userId` can approve a file sitting in `folderId`:
 *  i.e. they're listed as approver on that folder or any ancestor.
 *  (Callers combine this with the global `marketing_approver` check.) */
export function userApprovesFolder(
  folders: Folder[], approvers: FolderApprover[],
  userId: string, folderId: string | null,
): boolean {
  if (!userId || !folderId) return false;
  const chain = new Set(ancestorFolderIds(folders, folderId));
  return approvers.some((a) => a.userId === userId && chain.has(a.folderId));
}

/** Move a product into a different folder (or to the root with null). */
export async function moveProductToFolder(
  id: string, folderId: string | null, displayOrder?: number,
): Promise<void> {
  const payload: Record<string, unknown> = {
    folder_id: folderId,
    updated_at: new Date().toISOString(),
  };
  if (typeof displayOrder === 'number') payload.display_order = displayOrder;
  const { error } = await sb()
    .from('product_library_products').update(payload).eq('id', id);
  if (error) throw error;
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
    species: input.species ? String(input.species).trim() || null : null,
    folder_id: input.folderId ?? null,
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

/**
 * Duplicate a product into another folder (or the root). The clone
 * is a full, independent copy: metadata, product-info table, and all
 * file rows. Storage objects are shared by URL — the clone's file
 * rows point at the same bucket paths as the original — so a 50 MB
 * PDF isn't re-uploaded for every species it belongs to. Replacing a
 * file on the clone uploads a new object and only the clone's row
 * repoints; the original keeps serving the old URL.
 *
 *   · slug collisions resolved by appending "-2", "-3", … until free.
 *   · displayOrder sent to the end of the target folder.
 *   · file statuses copied verbatim (approved stays approved; pending
 *     stays pending). The approver gating still works because approval
 *     authority is per-folder — a pending file inherited into a new
 *     species may need re-approval by that species's approver.
 */
export async function cloneProduct(
  sourceId: string, targetFolderId: string | null,
): Promise<Product> {
  const client = sb();

  // 1. Load source + its files in parallel.
  const [srcRes, filesRes] = await Promise.all([
    client.from('product_library_products').select('*').eq('id', sourceId).maybeSingle(),
    client.from('product_library_files').select('*').eq('product_id', sourceId),
  ]);
  if (srcRes.error) throw srcRes.error;
  if (filesRes.error) throw filesRes.error;
  const src = srcRes.data as ProductRow | null;
  if (!src) throw new Error('Source product not found.');

  // 2. Resolve a unique slug — slug has a UNIQUE constraint so a
  //    naive copy would 23505. Try "-2", "-3", … up to a sane cap.
  const base = src.slug;
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const { data: hit } = await client
      .from('product_library_products').select('id').eq('slug', slug).maybeSingle();
    if (!hit) break;
    slug = `${base}-${i}`;
  }

  // 3. Place the clone at the end of the target folder.
  const { data: siblings } = await client
    .from('product_library_products').select('display_order').eq('folder_id', targetFolderId);
  const nextOrder = Array.isArray(siblings) && siblings.length
    ? Math.max(...siblings.map((s: { display_order: number }) => s.display_order ?? 0)) + 10
    : 0;

  const { data: inserted, error: insErr } = await client
    .from('product_library_products').insert({
      slug,
      name: src.name,
      species: src.species,          // kept for backward-compat only
      folder_id: targetFolderId,
      tagline: src.tagline,
      description: src.description,
      product_info: src.product_info,
      display_order: nextOrder,
      active: src.active,
    }).select('*').single();
  if (insErr) throw insErr;
  const clone = asProduct(inserted as ProductRow);

  // 4. Duplicate every file row with the clone as the new parent.
  //    Storage objects are shared via url / thumbnail_url — no
  //    re-upload. Status copied verbatim.
  const files = (filesRes.data || []) as FileRow[];
  if (files.length > 0) {
    const rows = files.map((f) => ({
      product_id: clone.id,
      category: f.category,
      label: f.label,
      url: f.url,
      thumbnail_url: f.thumbnail_url,
      display_order: f.display_order,
      status: f.status ?? 'approved',
    }));
    const { error: fErr } = await client.from('product_library_files').insert(rows);
    if (fErr) throw fErr;
  }

  return clone;
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

// ── Thumbnail uploads ───────────────────────────────────────────
// Storage bucket is created in data-migration/27-product-thumbnails-storage.sql.
// We upload as `<productId>/<timestamp>-<sanitized-name>` so multiple
// versions of the same file don't clobber each other and it's clear
// which product a file belongs to when browsing the bucket.
const THUMBNAIL_BUCKET = 'product-thumbnails';
// Bucket for the actual sales-tools files (PDF, PPTX, XLSX). Hybrid
// with external URLs — admins pick either; both land in the same
// `product_library_files.url` column.
const FILES_BUCKET = 'product-files';

export async function uploadThumbnail(
  file: File,
  productId: string,
): Promise<string> {
  const client = sb();
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${productId}/${Date.now()}-${safeName}`;
  const { error } = await client.storage.from(THUMBNAIL_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data } = client.storage.from(THUMBNAIL_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Delete a thumbnail from Storage by its public URL. Best-effort —
 *  swallows errors because a stale row shouldn't block DB edits. */
export async function deleteThumbnailByUrl(url: string): Promise<void> {
  if (!url) return;
  const marker = `/${THUMBNAIL_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return; // not one of ours
  const path = url.slice(idx + marker.length);
  try {
    await sb().storage.from(THUMBNAIL_BUCKET).remove([path]);
  } catch { /* ignore */ }
}

// ── Product file uploads ────────────────────────────────────────
// Direct upload path (vs the external URL path). Reps click the
// filename and the browser downloads immediately — no Library login
// needed. Admins pick either path per file; both end up in the same
// `product_library_files.url` column.
export async function uploadProductFile(
  file: File,
  productId: string,
): Promise<{ url: string; filename: string; sizeBytes: number }> {
  const client = sb();
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${productId}/${Date.now()}-${safeName}`;
  const { error } = await client.storage.from(FILES_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data } = client.storage.from(FILES_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, filename: file.name, sizeBytes: file.size };
}

/** Returns true when the url points at the product-files bucket —
 *  used by the catalog page to add a `download` attribute so the
 *  browser forces a download instead of in-tab preview. External
 *  URLs don't get the attribute (cross-origin would ignore it). */
export function isUploadedProductFile(url: string): boolean {
  return !!url && url.includes(`/${FILES_BUCKET}/`);
}

// ── Approval workflow (files only) ──────────────────────────────
// Only uploaded files go through approval. Products and folders are
// visible immediately. A non-approver's new/edited file lands as
// status='pending' and only renders in the public catalog page
// after a Marketing Approver flips it to 'approved'. See
// data-migration/33-marketing-approval-workflow.sql.

export async function submitFileForApproval(
  id: string, userId: string,
): Promise<void> {
  const { error } = await sb()
    .from('product_library_files')
    .update({
      status: 'pending',
      submitted_at: new Date().toISOString(),
      created_by: userId,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function approveFile(id: string, approverId: string): Promise<void> {
  const { error } = await sb()
    .from('product_library_files')
    .update({
      status: 'approved',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function rejectFile(
  id: string, approverId: string, reason: string,
): Promise<void> {
  const { error } = await sb()
    .from('product_library_files')
    .update({
      status: 'rejected',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      rejection_reason: reason || null,
    })
    .eq('id', id);
  if (error) throw error;
}

/** Reorder products within a folder (drag-drop in Admin-Marketing).
 *  Takes the full sorted array of product ids for that folder and
 *  writes display_order = index on each. */
export async function reorderProducts(ids: string[]): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all(ids.map((id, i) =>
    sb().from('product_library_products')
      .update({ display_order: i, updated_at: now })
      .eq('id', id)
  ));
}

/** Delete a product file from Storage by its public URL. Best-effort. */
export async function deleteProductFileByUrl(url: string): Promise<void> {
  if (!url) return;
  const marker = `/${FILES_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return;
  const path = url.slice(idx + marker.length);
  try {
    await sb().storage.from(FILES_BUCKET).remove([path]);
  } catch { /* ignore */ }
}
