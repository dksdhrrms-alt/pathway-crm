'use client';

/**
 * Admin-Marketing — product catalog management, Google Drive-style.
 *
 * Design notes
 *   · Folders are a first-class entity (data-migration/34). Users
 *     create / rename / delete / drag folders freely. Folders can
 *     nest to any depth; the left panel is a recursive tree.
 *   · Products live inside a folder (or at the root). Drag a product
 *     onto a folder to move it there, or onto the root drop zone to
 *     pull it out.
 *   · Approval applies to UPLOADED FILES ONLY. New folders and new
 *     products show up immediately. A non-approver's new/edited file
 *     lands as `pending`; a Marketing Approver reviews it in the
 *     "Pending files" queue at the top.
 *
 * Permissions (hooks/useMenuAccess.ts):
 *   · `marketing`          → open this page + edit catalog; file
 *                            uploads/edits land as pending.
 *   · `marketing_approver` → additionally sees the pending queue +
 *                            Approve/Reject; their own uploads bypass
 *                            pending.
 *   · Admin / CEO / administrative_manager — full access by default.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';
import { useMenuAccess } from '@/hooks/useMenuAccess';
import {
  Product, ProductFile, Folder, FileCategory, FILE_CATEGORY_META,
  listProductsWithFiles, listFolders,
  upsertProduct, deleteProduct, toSlug,
  upsertFile, deleteFile,
  uploadProductFile, uploadThumbnail,
  approveFile, rejectFile, submitFileForApproval,
  createFolder, renameFolder, moveFolder, deleteFolder,
  moveProductToFolder,
} from '@/lib/productCatalog';

type ApprovalKind = 'draft' | 'pending' | 'approved' | 'rejected';

const STATUS_META: Record<ApprovalKind, { label: string; cls: string }> = {
  draft:    { label: 'Draft',    cls: 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-gray-300' },
  pending:  { label: 'Pending',  cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[(status as ApprovalKind)] ?? STATUS_META.approved;
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
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

// ── Tree helpers ────────────────────────────────────────────────
// Node kind — the recursive tree holds a mix of folders (parents)
// and products (leaves). This union keeps the renderer simple.
type TreeFolder = { kind: 'folder'; folder: Folder; children: TreeNode[] };
type TreeProduct = { kind: 'product'; product: Product };
type TreeNode = TreeFolder | TreeProduct;

function buildTree(folders: Folder[], products: Product[]): TreeNode[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const arr = byParent.get(f.parentId) || [];
    arr.push(f);
    byParent.set(f.parentId, arr);
  }
  const productsByFolder = new Map<string | null, Product[]>();
  for (const p of products) {
    const arr = productsByFolder.get(p.folderId) || [];
    arr.push(p);
    productsByFolder.set(p.folderId, arr);
  }
  function build(parentId: string | null): TreeNode[] {
    const subFolders = (byParent.get(parentId) || [])
      .slice().sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    const subProducts = (productsByFolder.get(parentId) || [])
      .slice().sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    return [
      ...subFolders.map<TreeFolder>((f) => ({ kind: 'folder', folder: f, children: build(f.id) })),
      ...subProducts.map<TreeProduct>((p) => ({ kind: 'product', product: p })),
    ];
  }
  return build(null);
}

/** Collect this folder + all descendant folder ids. Used to prevent
 *  dropping a folder into itself or one of its own children. */
function collectDescendantIds(folders: Folder[], rootId: string): Set<string> {
  const result = new Set<string>([rootId]);
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const arr = byParent.get(f.parentId) || [];
    arr.push(f);
    byParent.set(f.parentId, arr);
  }
  const walk = (id: string) => {
    for (const child of byParent.get(id) || []) {
      if (!result.has(child.id)) { result.add(child.id); walk(child.id); }
    }
  };
  walk(rootId);
  return result;
}

// Drag payload — either a folder being moved, or a product being moved.
type DragPayload =
  | { kind: 'folder'; id: string }
  | { kind: 'product'; id: string };

export default function AdminMarketingPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id ?? '';
  const { canAccess, loaded: permsLoaded } = useMenuAccess();

  const canEdit = canAccess('marketing');
  const canApprove = canAccess('marketing_approver');

  const [products, setProducts] = useState<Product[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(true);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [p, f] = await Promise.all([listProductsWithFiles(), listFolders()]);
      setProducts(p);
      setFolders(f);
      // Expand all folders by default on first load so new users see
      // their whole catalog. After that we preserve the current expand
      // state (no automatic collapse).
      setExpanded((prev) => prev.size === 0 ? new Set(f.map((x) => x.id)) : prev);
    } catch (e) { setError(formatErr(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (permsLoaded && canEdit) load(); }, [permsLoaded, canEdit, load]);

  useEffect(() => {
    if (permsLoaded && !canEdit) router.replace('/dashboard');
  }, [permsLoaded, canEdit, router]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedId) ?? null,
    [products, selectedId],
  );

  const tree = useMemo(() => buildTree(folders, products), [folders, products]);

  const pendingFiles = useMemo(
    () => products.flatMap((p) =>
      p.files.filter((f) => f.status === 'pending').map((f) => ({ file: f, product: p })),
    ),
    [products],
  );

  // ── Folder actions ────────────────────────────────────────────
  async function handleNewFolder(parentId: string | null) {
    const name = prompt(parentId ? 'New subfolder name:' : 'New folder name:');
    if (!name || !name.trim()) return;
    try {
      const siblings = folders.filter((f) => f.parentId === parentId);
      const nextOrder = siblings.length ? Math.max(...siblings.map((s) => s.displayOrder)) + 10 : 0;
      const created = await createFolder(name, parentId, nextOrder);
      await load();
      // Auto-expand parent + the new folder.
      setExpanded((prev) => {
        const next = new Set(prev);
        if (parentId) next.add(parentId);
        next.add(created.id);
        return next;
      });
      setToast(`Created folder "${created.name}"`);
    } catch (e) { setError(formatErr(e)); }
  }

  async function handleRenameFolder(id: string, newName: string) {
    if (!newName.trim()) { setRenamingFolderId(null); return; }
    try {
      await renameFolder(id, newName);
      await load();
    } catch (e) { setError(formatErr(e)); }
    finally { setRenamingFolderId(null); }
  }

  async function handleDeleteFolder(f: Folder) {
    const childCount =
      folders.filter((x) => x.parentId === f.id).length +
      products.filter((p) => p.folderId === f.id).length;
    const msg = childCount > 0
      ? `Delete "${f.name}"? Its ${childCount} items will move to the parent folder.`
      : `Delete folder "${f.name}"?`;
    if (!confirm(msg)) return;
    try {
      // ON DELETE SET NULL on parent_id/folder_id reparents children
      // to the root. If this folder had its own parent, promote
      // children to that parent instead for a less surprising UX.
      if (f.parentId) {
        for (const child of folders.filter((x) => x.parentId === f.id)) {
          await moveFolder(child.id, f.parentId);
        }
        for (const prod of products.filter((p) => p.folderId === f.id)) {
          await moveProductToFolder(prod.id, f.parentId);
        }
      }
      await deleteFolder(f.id);
      await load();
      setToast(`Deleted folder "${f.name}"`);
    } catch (e) { setError(formatErr(e)); }
  }

  // ── Product actions ───────────────────────────────────────────
  async function handleNewProduct(folderId: string | null) {
    const name = prompt('New product name:');
    if (!name || !name.trim()) return;
    try {
      const siblings = products.filter((p) => p.folderId === folderId);
      const nextOrder = siblings.length ? Math.max(...siblings.map((s) => s.displayOrder)) + 10 : 0;
      const created = await upsertProduct({
        slug: toSlug(name), name,
        folderId, displayOrder: nextOrder,
      });
      await load();
      setSelectedId(created.id);
      if (folderId) setExpanded((prev) => { const n = new Set(prev); n.add(folderId); return n; });
      setToast(`Added "${name}"`);
    } catch (e) { setError(formatErr(e)); }
  }

  async function saveSelected(patch: Partial<Product>) {
    if (!selectedProduct) return;
    const next = { ...selectedProduct, ...patch };
    try {
      await upsertProduct({
        id: next.id, slug: next.slug, name: next.name,
        folderId: next.folderId, species: next.species,
        tagline: next.tagline, description: next.description,
        productInfo: next.productInfo, displayOrder: next.displayOrder, active: next.active,
      });
      await load();
      setToast(`Saved "${next.name}"`);
    } catch (e) { setError(formatErr(e)); }
  }

  async function removeSelected() {
    if (!selectedProduct) return;
    if (!confirm(`Delete "${selectedProduct.name}" and all its files?`)) return;
    try {
      await deleteProduct(selectedProduct.id);
      await load();
      setSelectedId(null);
      setToast(`Deleted "${selectedProduct.name}"`);
    } catch (e) { setError(formatErr(e)); }
  }

  // ── File actions (approval only applies here) ────────────────
  async function addFileRow(productId: string, category: FileCategory, file: File) {
    try {
      const res = await uploadProductFile(file, productId);
      const existing = products.find((p) => p.id === productId)?.files
        .filter((f) => f.category === category) || [];
      const order = existing.length ? Math.max(...existing.map((x) => x.displayOrder)) + 10 : 0;
      const created = await upsertFile({
        productId, category,
        label: res.filename, url: res.url,
        displayOrder: order,
      });
      if (!canApprove) await submitFileForApproval(created.id, userId);
      await load();
      setToast(`Uploaded "${res.filename}"${canApprove ? '' : ' — pending approval'}`);
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
    try { await deleteFile(f.id); await load(); } catch (e) { setError(formatErr(e)); }
  }

  async function approveF(id: string) { try { await approveFile(id, userId); await load(); setToast('Approved'); } catch (e) { setError(formatErr(e)); } }
  async function rejectF(id: string) {
    const reason = prompt('Rejection reason (optional):') || '';
    try { await rejectFile(id, userId, reason); await load(); setToast('Rejected'); } catch (e) { setError(formatErr(e)); }
  }

  // ── Drag & drop ──────────────────────────────────────────────
  const drag = useRef<DragPayload | null>(null);

  async function dropOnFolder(targetFolderId: string | null) {
    const payload = drag.current;
    drag.current = null;
    if (!payload) return;

    if (payload.kind === 'folder') {
      // Prevent dropping into self / own descendants.
      if (targetFolderId !== null) {
        const banned = collectDescendantIds(folders, payload.id);
        if (banned.has(targetFolderId)) {
          setError('Can\'t move a folder into itself.');
          return;
        }
      }
      const current = folders.find((f) => f.id === payload.id);
      if (current && current.parentId === targetFolderId) return;
      try {
        const siblings = folders.filter((f) => f.parentId === targetFolderId && f.id !== payload.id);
        const nextOrder = siblings.length ? Math.max(...siblings.map((s) => s.displayOrder)) + 10 : 0;
        await moveFolder(payload.id, targetFolderId, nextOrder);
        await load();
      } catch (e) { setError(formatErr(e)); }
      return;
    }

    // Product drop
    const current = products.find((p) => p.id === payload.id);
    if (current && current.folderId === targetFolderId) return;
    try {
      const siblings = products.filter((p) => p.folderId === targetFolderId && p.id !== payload.id);
      const nextOrder = siblings.length ? Math.max(...siblings.map((s) => s.displayOrder)) + 10 : 0;
      await moveProductToFolder(payload.id, targetFolderId, nextOrder);
      await load();
    } catch (e) { setError(formatErr(e)); }
  }

  // ── Render ────────────────────────────────────────────────────
  if (!permsLoaded) return null;
  if (!canEdit) return null;

  return (
    <>
      <TopBar />
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950 pt-16">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
          {/* Header */}
          <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Admin — Marketing</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Organize the Products catalog like a drive — create folders, nest subfolders, drag items anywhere.
                {canApprove
                  ? ' As Marketing Approver, your file uploads go live immediately and you can approve others\' submissions below.'
                  : ' Your file uploads land as pending until a Marketing Approver reviews them. Folders and products show up immediately.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => handleNewFolder(null)}
                className="text-sm px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 font-medium">
                + New Folder
              </button>
              <button onClick={() => handleNewProduct(null)}
                className="text-sm px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium">
                + New Product
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-3 p-3 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">
              {error}
              <button onClick={() => setError(null)} className="float-right text-xs opacity-70 hover:opacity-100">×</button>
            </div>
          )}

          {/* Pending files queue — approver-only; only files, no products */}
          {canApprove && pendingFiles.length > 0 && (
            <div className="mb-5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10">
              <button onClick={() => setShowPending(!showPending)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <span>⏳ Pending files ({pendingFiles.length})</span>
                <span>{showPending ? '▼' : '▶'}</span>
              </button>
              {showPending && (
                <div className="px-4 pb-4 space-y-2">
                  {pendingFiles.map(({ file, product }) => (
                    <div key={file.id} className="flex items-center gap-2 bg-white dark:bg-slate-900 rounded-lg border border-amber-200 dark:border-amber-800 p-2 text-sm">
                      <span className="font-medium flex-1 truncate">{product.name} · {file.label}</span>
                      <button onClick={() => approveF(file.id)} className="text-xs px-2 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-800">Approve</button>
                      <button onClick={() => rejectF(file.id)} className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200">Reject</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5">
            {/* Left: recursive folder tree */}
            <aside
              className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 h-fit lg:sticky lg:top-20 overflow-hidden"
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-emerald-400'); }}
              onDragLeave={(e) => e.currentTarget.classList.remove('ring-2', 'ring-emerald-400')}
              onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('ring-2', 'ring-emerald-400'); dropOnFolder(null); }}
            >
              <div className="px-3 py-2 border-b border-gray-100 dark:border-slate-800 text-[11px] text-gray-500 dark:text-gray-400 italic">
                Drag items to any folder · drop here to move to root
              </div>
              {loading ? (
                <div className="py-6 text-center text-sm text-gray-400">Loading…</div>
              ) : tree.length === 0 ? (
                <div className="py-6 text-center text-sm text-gray-400 italic px-3">
                  Empty. Click <span className="font-medium">+ New Folder</span> or <span className="font-medium">+ New Product</span> above.
                </div>
              ) : (
                <ul className="p-2 space-y-0.5">
                  {tree.map((node) => (
                    <TreeNodeView
                      key={nodeKey(node)}
                      node={node}
                      depth={0}
                      selectedId={selectedId}
                      expanded={expanded}
                      renamingFolderId={renamingFolderId}
                      drag={drag}
                      onSelectProduct={setSelectedId}
                      onToggle={(id) => setExpanded((prev) => {
                        const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
                      })}
                      onDropOnFolder={dropOnFolder}
                      onBeginRename={setRenamingFolderId}
                      onCommitRename={handleRenameFolder}
                      onNewFolder={handleNewFolder}
                      onNewProduct={handleNewProduct}
                      onDeleteFolder={handleDeleteFolder}
                    />
                  ))}
                </ul>
              )}
            </aside>

            {/* Right: editor */}
            <section className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
              {!selectedProduct ? (
                <div className="py-12 text-center text-sm text-gray-400">
                  Select a product on the left to edit — or create one with <span className="font-medium">+ New Product</span>.
                </div>
              ) : (
                <ProductEditor
                  key={selectedProduct.id}
                  product={selectedProduct}
                  folders={folders}
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

function nodeKey(n: TreeNode): string {
  return n.kind === 'folder' ? `f:${n.folder.id}` : `p:${n.product.id}`;
}

// ── Recursive tree node ───────────────────────────────────────
function TreeNodeView({
  node, depth, selectedId, expanded, renamingFolderId, drag,
  onSelectProduct, onToggle, onDropOnFolder,
  onBeginRename, onCommitRename, onNewFolder, onNewProduct, onDeleteFolder,
}: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  renamingFolderId: string | null;
  drag: React.MutableRefObject<DragPayload | null>;
  onSelectProduct: (id: string) => void;
  onToggle: (folderId: string) => void;
  onDropOnFolder: (folderId: string | null) => void;
  onBeginRename: (folderId: string | null) => void;
  onCommitRename: (id: string, name: string) => void;
  onNewFolder: (parentId: string | null) => void;
  onNewProduct: (folderId: string | null) => void;
  onDeleteFolder: (f: Folder) => void;
}) {
  const indent = { paddingLeft: `${depth * 14 + 8}px` };

  if (node.kind === 'folder') {
    const f = node.folder;
    const open = expanded.has(f.id);
    const renaming = renamingFolderId === f.id;
    return (
      <li>
        <div
          style={indent}
          draggable={!renaming}
          onDragStart={(e) => { drag.current = { kind: 'folder', id: f.id }; e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).classList.add('bg-emerald-50', 'dark:bg-emerald-900/20'); }}
          onDragLeave={(e) => (e.currentTarget as HTMLElement).classList.remove('bg-emerald-50', 'dark:bg-emerald-900/20')}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).classList.remove('bg-emerald-50', 'dark:bg-emerald-900/20'); onDropOnFolder(f.id); }}
          className="group flex items-center gap-1 py-1 pr-2 rounded text-sm hover:bg-gray-50 dark:hover:bg-slate-800"
        >
          <button onClick={() => onToggle(f.id)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-4 text-xs shrink-0">
            {open ? '▼' : '▶'}
          </button>
          <span className="shrink-0">📁</span>
          {renaming ? (
            <input autoFocus defaultValue={f.name}
              onBlur={(e) => onCommitRename(f.id, (e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                else if (e.key === 'Escape') onBeginRename(null);
              }}
              className="flex-1 min-w-0 border border-emerald-500 rounded px-1 py-0.5 text-sm bg-white dark:bg-slate-800 dark:text-gray-100" />
          ) : (
            <span className="flex-1 truncate text-gray-800 dark:text-gray-200 cursor-default"
              onDoubleClick={() => onBeginRename(f.id)}
              title="Double-click to rename">
              {f.name}
            </span>
          )}
          {/* Hover actions */}
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
            <IconBtn title="New subfolder" onClick={() => onNewFolder(f.id)}>📁+</IconBtn>
            <IconBtn title="New product" onClick={() => onNewProduct(f.id)}>+</IconBtn>
            <IconBtn title="Rename" onClick={() => onBeginRename(f.id)}>✎</IconBtn>
            <IconBtn title="Delete" onClick={() => onDeleteFolder(f)}>🗑</IconBtn>
          </div>
        </div>
        {open && node.children.length > 0 && (
          <ul className="space-y-0.5">
            {node.children.map((child) => (
              <TreeNodeView
                key={nodeKey(child)}
                node={child}
                depth={depth + 1}
                selectedId={selectedId}
                expanded={expanded}
                renamingFolderId={renamingFolderId}
                drag={drag}
                onSelectProduct={onSelectProduct}
                onToggle={onToggle}
                onDropOnFolder={onDropOnFolder}
                onBeginRename={onBeginRename}
                onCommitRename={onCommitRename}
                onNewFolder={onNewFolder}
                onNewProduct={onNewProduct}
                onDeleteFolder={onDeleteFolder}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  // Product leaf
  const p = node.product;
  const pending = p.files.filter((f) => f.status === 'pending').length;
  const rejected = p.files.filter((f) => f.status === 'rejected').length;
  return (
    <li>
      <div
        style={indent}
        draggable
        onDragStart={(e) => { drag.current = { kind: 'product', id: p.id }; e.dataTransfer.effectAllowed = 'move'; }}
        onClick={() => onSelectProduct(p.id)}
        className={`flex items-center gap-1 py-1 pr-2 rounded text-sm cursor-pointer ${
          selectedId === p.id
            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 font-medium'
            : 'hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-200'
        }`}
      >
        <span className="w-4 shrink-0" />
        <span className="shrink-0">📄</span>
        <span className="flex-1 truncate">{p.name}</span>
        {pending > 0 && <span title={`${pending} pending file(s)`} className="shrink-0 text-[10px] px-1 rounded bg-amber-100 text-amber-800">{pending}</span>}
        {rejected > 0 && <span title={`${rejected} rejected file(s)`} className="shrink-0 text-[10px] px-1 rounded bg-red-100 text-red-800">{rejected}</span>}
      </div>
    </li>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 px-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700">
      {children}
    </button>
  );
}

// ── Product editor panel ───────────────────────────────────────
function ProductEditor({
  product, folders,
  onSave, onDelete, onFileSave, onFileDelete, onFileAdd,
  onToast, onError, onReload,
}: {
  product: Product;
  folders: Folder[];
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

  // Folder path breadcrumb — "Turkey / Breast" style display.
  const folderPath = useMemo(() => {
    if (!draft.folderId) return 'Root';
    const map = new Map(folders.map((f) => [f.id, f] as const));
    const parts: string[] = [];
    let cur: Folder | undefined = map.get(draft.folderId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      parts.unshift(cur.name);
      seen.add(cur.id);
      cur = cur.parentId ? map.get(cur.parentId) : undefined;
    }
    return parts.join(' / ');
  }, [draft.folderId, folders]);

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
        rows: [...d.productInfo.rows, { label: '', values: new Array(Math.max(1, d.productInfo.columns.length)).fill('') }],
      },
    }));
  }
  function removeRow(idx: number) {
    setDraft((d) => ({ ...d, productInfo: { ...d.productInfo, rows: d.productInfo.rows.filter((_, i) => i !== idx) } }));
  }
  function updateRow(idx: number, p: { label?: string; values?: string[] }) {
    setDraft((d) => ({
      ...d,
      productInfo: { ...d.productInfo, rows: d.productInfo.rows.map((r, i) => i === idx ? { ...r, ...p } : r) },
    }));
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3 pb-3 border-b border-gray-100 dark:border-slate-800">
        <div className="flex-1 min-w-0">
          <input value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="w-full text-lg font-semibold bg-transparent border-0 border-b border-transparent hover:border-gray-300 focus:border-emerald-500 focus:outline-none text-gray-900 dark:text-gray-100 px-0 py-1 mb-1" />
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>📁 {folderPath}</span>
            <span className="font-mono">/products/{draft.slug}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => onSave(draft)}
            className="text-sm px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium">Save</button>
          <button onClick={onDelete}
            className="text-sm px-2.5 py-1.5 rounded-lg text-red-600 hover:bg-red-50">Delete</button>
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
          <ColumnsInput initial={draft.productInfo.columns.join(', ')} onCommit={updateColumns} />
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
                    <button onClick={() => removeRow(ri)} className="text-red-500 hover:text-red-700 text-xs">×</button>
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
                  <FileUploadButton label="+ Upload" onPick={(file) => onFileAdd(product.id, cat.key, file)} />
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
