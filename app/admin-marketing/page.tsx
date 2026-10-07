'use client';

/**
 * Admin-Marketing — product catalog management, extracted from the
 * main Admin tab (app/admin/page.tsx).
 *
 * Why its own route?
 *   · Non-admin editors need write access to the catalog but not to
 *     the rest of Admin (users, permissions, data health).
 *   · Changes shouldn't go live immediately — there's an approval
 *     flow (draft → pending → approved) so a Marketing Approver can
 *     gate what reps actually see on the sidebar / Products page.
 *
 * Permissions (hooks/useMenuAccess.ts):
 *   · 'marketing'          → can open this page + edit catalog;
 *                            edits land as status='pending'.
 *   · 'marketing_approver' → additionally sees the "Pending Approval"
 *                            queue + Approve/Reject buttons; their
 *                            edits bypass pending.
 *   · Admin/CEO/administrative_manager have full access by default.
 *
 * UX:
 *   · Left: 2-level tree (Species → Product) with HTML5 drag-and-drop.
 *     Drop a product onto another species header to reparent;
 *     drop onto another product to reorder within that species.
 *   · Right: editor for the selected product (name, species, tagline,
 *     description, product-info table, per-category files).
 *   · Top (approver only): "Pending Approval" collapsible queue of
 *     products + files awaiting review.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';
import { useMenuAccess } from '@/hooks/useMenuAccess';
import {
  Product, ProductFile, FileCategory, FILE_CATEGORY_META,
  listProductsWithFiles, upsertProduct, deleteProduct, toSlug,
  upsertFile, deleteFile,
  uploadProductFile, uploadThumbnail,
  approveProduct, rejectProduct, approveFile, rejectFile,
  submitProductForApproval, submitFileForApproval,
  updateProductSpecies, reorderProducts,
} from '@/lib/productCatalog';

type StatusBadgeKind = 'draft' | 'pending' | 'approved' | 'rejected';

const STATUS_META: Record<StatusBadgeKind, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-gray-300' },
  pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[(status as StatusBadgeKind)] ?? STATUS_META.approved;
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

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

export default function AdminMarketingPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id ?? '';
  const { canAccess, loaded: permsLoaded } = useMenuAccess();

  const canEdit = canAccess('marketing');
  const canApprove = canAccess('marketing_approver');

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [showPending, setShowPending] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const rows = await listProductsWithFiles();
      setProducts(rows);
      // If currently selected id is gone (deleted), clear it.
      setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : (rows[0]?.id ?? null)));
    } catch (e) { setError(formatErr(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (permsLoaded && canEdit) load(); }, [permsLoaded, canEdit, load]);

  // Redirect out if the user lacks marketing permission. We wait for
  // perms to load first so we don't flash a redirect on refresh.
  useEffect(() => {
    if (permsLoaded && !canEdit) router.replace('/dashboard');
  }, [permsLoaded, canEdit, router]);

  const selected = useMemo(
    () => products.find((p) => p.id === selectedId) ?? null,
    [products, selectedId],
  );

  const bySpecies = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      const key = p.species && p.species.trim() ? p.species.trim() : '__ungrouped__';
      const arr = map.get(key) || [];
      arr.push(p);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([species, items]) => ({
        species,
        display: species === '__ungrouped__' ? 'Ungrouped' : species,
        items: items.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.species === '__ungrouped__' ? 1 : b.species === '__ungrouped__' ? -1 : a.display.localeCompare(b.display));
  }, [products]);

  const pendingProducts = useMemo(() => products.filter((p) => p.status === 'pending'), [products]);
  const pendingFiles = useMemo(
    () => products.flatMap((p) => p.files.filter((f) => f.status === 'pending').map((f) => ({ file: f, product: p }))),
    [products],
  );

  // ── Mutations ────────────────────────────────────────────────
  // Non-approvers' writes land as 'pending'. Approvers' writes stay
  // 'approved' so they can edit live catalog without needing a
  // second person to click Approve.
  const nextStatus = (): 'approved' | 'pending' => (canApprove ? 'approved' : 'pending');

  async function addProduct() {
    const name = newName.trim();
    if (!name) return;
    try {
      const nextOrder = products.length ? Math.max(...products.map((p) => p.displayOrder)) + 10 : 0;
      const created = await upsertProduct({ slug: toSlug(name), name, displayOrder: nextOrder });
      // Stamp status + created_by for workflow tracking.
      if (nextStatus() === 'pending') {
        await submitProductForApproval(created.id, userId);
      }
      setNewName('');
      await load();
      setSelectedId(created.id);
      setToast(`Added "${name}"${nextStatus() === 'pending' ? ' (pending approval)' : ''}`);
    } catch (e) { setError(formatErr(e)); }
  }

  async function saveSelected(patch: Partial<Product>) {
    if (!selected) return;
    const next = { ...selected, ...patch };
    try {
      await upsertProduct({
        id: next.id, slug: next.slug, name: next.name,
        species: next.species,
        tagline: next.tagline, description: next.description,
        productInfo: next.productInfo, displayOrder: next.displayOrder, active: next.active,
      });
      // If a non-approver edits an approved row, bump it back to pending.
      if (!canApprove && next.status === 'approved') {
        await submitProductForApproval(next.id, userId);
      }
      await load();
      setToast(`Saved "${next.name}"`);
    } catch (e) { setError(formatErr(e)); }
  }

  async function removeSelected() {
    if (!selected) return;
    if (!confirm(`Delete "${selected.name}" and all its files?`)) return;
    try {
      await deleteProduct(selected.id);
      await load();
      setToast(`Deleted "${selected.name}"`);
    } catch (e) { setError(formatErr(e)); }
  }

  async function addFileRow(productId: string, category: FileCategory, file: File) {
    try {
      const res = await uploadProductFile(file, productId);
      const existing = products.find((p) => p.id === productId)?.files.filter((f) => f.category === category) || [];
      const order = existing.length ? Math.max(...existing.map((x) => x.displayOrder)) + 10 : 0;
      const created = await upsertFile({
        productId, category,
        label: res.filename, url: res.url,
        displayOrder: order,
      });
      if (!canApprove) await submitFileForApproval(created.id, userId);
      await load();
      setToast(`Uploaded "${res.filename}"${canApprove ? '' : ' (pending approval)'}`);
    } catch (e) { setError(formatErr(e)); }
  }

  async function saveFileRow(f: ProductFile, patch: Partial<ProductFile>) {
    const next = { ...f, ...patch };
    try {
      await upsertFile({
        id: next.id, productId: next.productId, category: next.category,
        label: next.label, url: next.url,
        thumbnailUrl: next.thumbnailUrl, displayOrder: next.displayOrder,
      });
      if (!canApprove && next.status === 'approved') {
        await submitFileForApproval(next.id, userId);
      }
      await load();
    } catch (e) { setError(formatErr(e)); }
  }

  async function removeFileRow(f: ProductFile) {
    if (!confirm(`Delete file "${f.label}"?`)) return;
    try { await deleteFile(f.id); await load(); }
    catch (e) { setError(formatErr(e)); }
  }

  // Approval actions
  async function approveP(id: string) { try { await approveProduct(id, userId); await load(); setToast('Approved'); } catch (e) { setError(formatErr(e)); } }
  async function rejectP(id: string) { const reason = prompt('Reason (optional):') || ''; try { await rejectProduct(id, userId, reason); await load(); setToast('Rejected'); } catch (e) { setError(formatErr(e)); } }
  async function approveF(id: string) { try { await approveFile(id, userId); await load(); setToast('File approved'); } catch (e) { setError(formatErr(e)); } }
  async function rejectF(id: string) { const reason = prompt('Reason (optional):') || ''; try { await rejectFile(id, userId, reason); await load(); setToast('File rejected'); } catch (e) { setError(formatErr(e)); } }

  // ── Drag & drop ──────────────────────────────────────────────
  // dragProductId: product being dragged.
  // Dropping onto a species header reparents + places at the end of
  // that species. Dropping onto another product reorders adjacent to it
  // (and reparents to that product's species if different).
  const dragId = useRef<string | null>(null);

  async function onDropToSpecies(targetSpecies: string) {
    const id = dragId.current;
    dragId.current = null;
    if (!id) return;
    const dragged = products.find((p) => p.id === id);
    if (!dragged) return;
    const newSpecies = targetSpecies === '__ungrouped__' ? null : targetSpecies;
    if ((dragged.species ?? null) === newSpecies) return;
    try {
      // Append to the end of the target species.
      const siblings = products.filter((p) => (p.species ?? '__ungrouped__') === (newSpecies ?? '__ungrouped__'));
      const nextOrder = siblings.length ? Math.max(...siblings.map((s) => s.displayOrder)) + 10 : 0;
      await updateProductSpecies(id, newSpecies, nextOrder);
      await load();
    } catch (e) { setError(formatErr(e)); }
  }

  async function onDropOnProduct(targetId: string) {
    const id = dragId.current;
    dragId.current = null;
    if (!id || id === targetId) return;
    const dragged = products.find((p) => p.id === id);
    const target = products.find((p) => p.id === targetId);
    if (!dragged || !target) return;
    try {
      // Reparent if species differs.
      if ((dragged.species ?? null) !== (target.species ?? null)) {
        await updateProductSpecies(id, target.species, target.displayOrder);
      }
      // Build the new ordering within the target species: insert
      // dragged just before target.
      const speciesKey = target.species ?? '__ungrouped__';
      const list = products
        .filter((p) => (p.species ?? '__ungrouped__') === speciesKey && p.id !== id)
        .sort((a, b) => a.displayOrder - b.displayOrder);
      const insertIdx = list.findIndex((p) => p.id === targetId);
      const ordered = [...list.slice(0, insertIdx), dragged, ...list.slice(insertIdx)];
      await reorderProducts(ordered.map((p) => p.id));
      await load();
    } catch (e) { setError(formatErr(e)); }
  }

  // ── Render ────────────────────────────────────────────────────
  if (!permsLoaded) return null;
  if (!canEdit) return null; // redirect in flight

  return (
    <>
      <TopBar />
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950 pt-16">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
          <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Admin — Marketing</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Curate the Products catalog. {canApprove
                  ? 'As Marketing Approver, your edits go live immediately and you can approve others\' submissions below.'
                  : 'Your edits land as pending until a Marketing Approver reviews them.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addProduct(); }}
                placeholder="New product name"
                className="border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm w-64" />
              <button onClick={addProduct}
                className="text-sm px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium">
                + Add Product
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-3 p-3 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">
              {error}
              <button onClick={() => setError(null)} className="float-right text-xs opacity-70 hover:opacity-100">×</button>
            </div>
          )}

          {/* Pending Approval queue — approver-only */}
          {canApprove && (pendingProducts.length > 0 || pendingFiles.length > 0) && (
            <div className="mb-5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10">
              <button onClick={() => setShowPending(!showPending)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <span>⏳ Pending Approval ({pendingProducts.length + pendingFiles.length})</span>
                <span>{showPending ? '▼' : '▶'}</span>
              </button>
              {showPending && (
                <div className="px-4 pb-4 space-y-2">
                  {pendingProducts.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 bg-white dark:bg-slate-900 rounded-lg border border-amber-200 dark:border-amber-800 p-2 text-sm">
                      <span className="font-medium flex-1">Product · {p.name}</span>
                      <span className="text-xs text-gray-500">{p.species || 'Ungrouped'}</span>
                      <button onClick={() => approveP(p.id)} className="text-xs px-2 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-800">Approve</button>
                      <button onClick={() => rejectP(p.id)} className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200">Reject</button>
                    </div>
                  ))}
                  {pendingFiles.map(({ file, product }) => (
                    <div key={file.id} className="flex items-center gap-2 bg-white dark:bg-slate-900 rounded-lg border border-amber-200 dark:border-amber-800 p-2 text-sm">
                      <span className="font-medium flex-1 truncate">File · {product.name} · {file.label}</span>
                      <button onClick={() => approveF(file.id)} className="text-xs px-2 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-800">Approve</button>
                      <button onClick={() => rejectF(file.id)} className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200">Reject</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
            {/* Left: species → product tree with drag-drop */}
            <aside className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-3 h-fit lg:sticky lg:top-20">
              {loading ? (
                <div className="py-6 text-center text-sm text-gray-400">Loading…</div>
              ) : products.length === 0 ? (
                <div className="py-6 text-center text-sm text-gray-400 italic">
                  No products — add the first one above.
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 italic mb-1">
                    Drag products to reorder or move between species.
                  </p>
                  {bySpecies.map((group) => (
                    <div key={group.species}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-emerald-400'); }}
                      onDragLeave={(e) => { e.currentTarget.classList.remove('ring-2', 'ring-emerald-400'); }}
                      onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('ring-2', 'ring-emerald-400'); onDropToSpecies(group.species); }}
                      className="rounded-lg bg-gray-50 dark:bg-slate-800/40 p-2"
                    >
                      <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide mb-1 px-1">
                        {group.display} <span className="text-gray-400 font-normal">({group.items.length})</span>
                      </div>
                      <ul className="space-y-1">
                        {group.items.map((p) => (
                          <li key={p.id}
                            draggable
                            onDragStart={(e) => { dragId.current = p.id; e.dataTransfer.effectAllowed = 'move'; }}
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropOnProduct(p.id); }}
                            onClick={() => setSelectedId(p.id)}
                            className={`cursor-pointer flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                              selectedId === p.id
                                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 font-medium'
                                : 'hover:bg-white dark:hover:bg-slate-800 text-gray-700 dark:text-gray-200'
                            }`}
                          >
                            <span className="text-gray-400 text-xs select-none">⋮⋮</span>
                            <span className="flex-1 truncate">{p.name}</span>
                            <StatusBadge status={p.status} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </aside>

            {/* Right: editor */}
            <section className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
              {!selected ? (
                <div className="py-12 text-center text-sm text-gray-400">
                  Select a product on the left to edit.
                </div>
              ) : (
                <ProductEditor
                  key={selected.id}
                  product={selected}
                  allSpecies={Array.from(new Set(products.map((x) => x.species).filter(Boolean))) as string[]}
                  onSave={saveSelected}
                  onDelete={removeSelected}
                  onFileSave={saveFileRow}
                  onFileDelete={removeFileRow}
                  onFileAdd={addFileRow}
                  onToast={setToast}
                  onError={setError}
                  onReload={load}
                />
              )}
            </section>
          </div>
        </div>
        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      </div>
    </>
  );
}

// ── Product editor panel ───────────────────────────────────────
function ProductEditor({
  product, allSpecies,
  onSave, onDelete, onFileSave, onFileDelete, onFileAdd,
  onToast, onError, onReload,
}: {
  product: Product;
  allSpecies: string[];
  onSave: (patch: Partial<Product>) => Promise<void> | void;
  onDelete: () => void;
  onFileSave: (f: ProductFile, patch: Partial<ProductFile>) => Promise<void> | void;
  onFileDelete: (f: ProductFile) => void;
  onFileAdd: (productId: string, category: FileCategory, file: File) => Promise<void> | void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
  onReload: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<Product>(product);
  useEffect(() => { setDraft(product); }, [product]);

  function patch(p: Partial<Product>) { setDraft((d) => ({ ...d, ...p })); }

  function updateColumns(colsText: string) {
    const cols = colsText.split(',').map((s) => s.trim()).filter(Boolean);
    setDraft((d) => ({
      ...d,
      productInfo: {
        columns: cols,
        rows: d.productInfo.rows.map((r) => {
          const values = [...r.values];
          while (values.length < cols.length) values.push('');
          values.length = cols.length;
          return { ...r, values };
        }),
      },
    }));
  }
  function addRow() {
    setDraft((d) => ({
      ...d,
      productInfo: {
        columns: d.productInfo.columns.length > 0 ? d.productInfo.columns : ['Value'],
        rows: [...d.productInfo.rows, {
          label: '',
          values: new Array(Math.max(1, d.productInfo.columns.length)).fill(''),
        }],
      },
    }));
  }
  function removeRow(idx: number) {
    setDraft((d) => ({ ...d, productInfo: { ...d.productInfo, rows: d.productInfo.rows.filter((_, i) => i !== idx) } }));
  }
  function updateRow(idx: number, p: { label?: string; values?: string[] }) {
    setDraft((d) => ({
      ...d,
      productInfo: {
        ...d.productInfo,
        rows: d.productInfo.rows.map((r, i) => i === idx ? { ...r, ...p } : r),
      },
    }));
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3 pb-3 border-b border-gray-100 dark:border-slate-800">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <input value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              className="flex-1 min-w-0 text-lg font-semibold bg-transparent border-0 border-b border-transparent hover:border-gray-300 focus:border-emerald-500 focus:outline-none text-gray-900 dark:text-gray-100 px-0 py-1" />
            <StatusBadge status={draft.status} />
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="font-mono">/products/{draft.slug}</span>
            {draft.rejectionReason && (
              <span className="text-red-600">· Rejected: {draft.rejectionReason}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => onSave(draft)}
            className="text-sm px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium">
            Save
          </button>
          <button onClick={onDelete}
            className="text-sm px-2.5 py-1.5 rounded-lg text-red-600 hover:bg-red-50">Delete</button>
        </div>
      </div>

      {/* Species + display order */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Species (sidebar group)</label>
          <input value={draft.species || ''}
            onChange={(e) => patch({ species: e.target.value || null })}
            placeholder="Turkey / Broiler / Swine / Dairy — blank = Ungrouped"
            list="am-species-options"
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
          <datalist id="am-species-options">
            {allSpecies.map((sp) => <option key={sp} value={sp} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Order</label>
          <input type="number" value={draft.displayOrder}
            onChange={(e) => patch({ displayOrder: Number(e.target.value) || 0 })}
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {/* Tagline + description */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Tagline</label>
        <input value={draft.tagline || ''}
          onChange={(e) => patch({ tagline: e.target.value })}
          placeholder="The First Absorption Accelerator"
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Description</label>
        <textarea value={draft.description || ''}
          onChange={(e) => patch({ description: e.target.value })}
          rows={5}
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm resize-y" />
      </div>

      {/* Product information table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Product Information Table</label>
          <button onClick={addRow}
            className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200">+ Row</button>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Columns (comma-separated):</span>
          <ColumnsInput
            initial={draft.productInfo.columns.join(', ')}
            onCommit={updateColumns}
          />
        </div>
        {draft.productInfo.rows.length > 0 && (
          <table className="w-full text-xs">
            <tbody>
              {draft.productInfo.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-gray-50 dark:border-slate-800">
                  <td className="py-1 pr-2 w-[30%]">
                    <input value={row.label}
                      onChange={(e) => updateRow(ri, { label: e.target.value })}
                      placeholder="Inclusion rate"
                      className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-xs" />
                  </td>
                  {draft.productInfo.columns.map((_, ci) => (
                    <td key={ci} className="py-1 pr-2">
                      <input value={row.values[ci] || ''}
                        onChange={(e) => {
                          const values = [...row.values];
                          values[ci] = e.target.value;
                          updateRow(ri, { values });
                        }}
                        placeholder="0.6 lb/ton"
                        className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-xs" />
                    </td>
                  ))}
                  <td className="py-1 w-8 text-right">
                    <button onClick={() => removeRow(ri)}
                      className="text-red-500 hover:text-red-700 text-xs">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Sales Tools (files) */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Sales Tools</label>
        <div className="space-y-3">
          {FILE_CATEGORY_META.map((cat) => {
            const items = product.files.filter((f) => f.category === cat.key)
              .sort((a, b) => a.displayOrder - b.displayOrder);
            return (
              <div key={cat.key} className="border border-gray-100 dark:border-slate-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase">
                    {cat.emoji} {cat.label}
                  </span>
                  <FileUploadButton
                    label="+ Upload"
                    onPick={(file) => onFileAdd(product.id, cat.key, file)}
                  />
                </div>
                {items.length === 0 ? (
                  <div className="text-[11px] text-gray-400 italic">No files.</div>
                ) : (
                  <ul className="space-y-2">
                    {items.map((f) => (
                      <FileRow
                        key={f.id}
                        file={f}
                        onSave={(patch) => onFileSave(f, patch)}
                        onDelete={() => onFileDelete(f)}
                        onToast={onToast}
                        onError={onError}
                        onReload={onReload}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Small inputs & buttons ───────────────────────────────────────
function ColumnsInput({ initial, onCommit }: { initial: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(initial);
  useEffect(() => { setText(initial); }, [initial]);
  return (
    <input value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
      placeholder="Imperial, Metric"
      className="flex-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-xs" />
  );
}

function FileUploadButton({ label, onPick, accept }: { label: string; onPick: (file: File) => void; accept?: string }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]; if (ref.current) ref.current.value = '';
          if (!f) return;
          if (f.size > 50 * 1024 * 1024) { alert('File too large (50 MB max).'); return; }
          setBusy(true); try { await onPick(f); } finally { setBusy(false); }
        }} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy}
        className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-medium disabled:opacity-50">
        {busy ? '↑ …' : label}
      </button>
    </>
  );
}

function FileRow({
  file, onSave, onDelete, onToast, onError, onReload,
}: {
  file: ProductFile;
  onSave: (patch: Partial<ProductFile>) => Promise<void> | void;
  onDelete: () => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
  onReload: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(file);
  useEffect(() => { setDraft(file); }, [file]);
  const thumbRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function pickThumb(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (thumbRef.current) thumbRef.current.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { onError('Thumbnail must be an image.'); return; }
    if (f.size > 3 * 1024 * 1024) { onError('Thumbnail too large (3 MB).'); return; }
    try {
      const url = await uploadThumbnail(f, file.productId);
      setDraft((d) => ({ ...d, thumbnailUrl: url }));
      await onSave({ thumbnailUrl: url });
      onToast('Thumbnail uploaded');
    } catch (err) { onError(formatErr(err)); }
  }
  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { onError('File too large (50 MB).'); return; }
    try {
      const res = await uploadProductFile(f, file.productId);
      const nextLabel = (draft.label || '').trim() || res.filename;
      setDraft((d) => ({ ...d, url: res.url, label: nextLabel }));
      await onSave({ url: res.url, label: nextLabel });
      onToast(`Uploaded "${res.filename}"`);
    } catch (err) { onError(formatErr(err)); }
    await onReload();
  }

  return (
    <li className="flex items-start gap-2 p-2 rounded border border-gray-100 dark:border-slate-800">
      {draft.thumbnailUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={draft.thumbnailUrl} alt=""
          className="w-12 h-12 flex-shrink-0 object-cover rounded border border-gray-200 dark:border-slate-700 bg-white"
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.2'; }} />
      ) : (
        <div className="w-12 h-12 flex-shrink-0 rounded border border-dashed border-gray-300 dark:border-slate-700 flex items-center justify-center text-[9px] text-gray-400">
          no img
        </div>
      )}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-1.5">
          <input value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="File label"
            className="flex-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-xs" />
          <StatusBadge status={draft.status} />
        </div>
        <div className="flex items-center gap-1.5">
          <input value={draft.url}
            onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
            placeholder="File URL — paste or upload →"
            className="flex-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-xs font-mono" />
          <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />
          <button type="button" onClick={() => fileRef.current?.click()}
            className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200">↑ Upload</button>
        </div>
        <div className="flex items-center gap-1.5">
          <input value={draft.thumbnailUrl || ''}
            onChange={(e) => setDraft((d) => ({ ...d, thumbnailUrl: e.target.value || null }))}
            placeholder="Thumbnail URL — or upload →"
            className="flex-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded px-2 py-1 text-xs font-mono" />
          <input ref={thumbRef} type="file" accept="image/*" className="hidden" onChange={pickThumb} />
          <button type="button" onClick={() => thumbRef.current?.click()}
            className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200">↑ Thumb</button>
        </div>
        {draft.rejectionReason && (
          <div className="text-[11px] text-red-600">Rejected: {draft.rejectionReason}</div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <button onClick={() => onSave({
          label: draft.label, url: draft.url,
          thumbnailUrl: draft.thumbnailUrl, displayOrder: draft.displayOrder,
        })} className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-medium">Save</button>
        <button onClick={onDelete} className="text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50">Delete</button>
      </div>
    </li>
  );
}
