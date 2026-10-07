'use client';

/**
 * Product catalog page — renders one product's "PPT-style" catalog
 * (see "Product sheet on CRM_ver.1.02_20260806.pptx"). Reads the row
 * from Supabase on mount, no SSR needed.
 *
 * Layout mirrors the PPT slide directly:
 *   ┌ Hero      (name / tagline / description, left-aligned)
 *   ├ Product Information table
 *   └ Sales Tools
 *       Row 1: [ Sales presentations ]  [ Flyers ]
 *       Row 2: [ Calculators         ]  [ Technical bulletins ]
 *       Row 3: [ Documents (full width, auto-column list) ]
 *
 * Each file card shows an optional preview thumbnail above the
 * filename link. Filename click opens the Pathway Library URL in a
 * new tab — the browser handles download/preview based on
 * Content-Disposition.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import TopBar from '@/app/components/TopBar';
import { getProductBySlug, isUploadedProductFile, type Product, type ProductFile, type FileCategory } from '@/lib/productCatalog';

// Section metadata for the Sales Tools grid.
const SALES_TOOL_SECTIONS: { key: FileCategory; label: string }[] = [
  { key: 'presentation',       label: 'Sales presentations' },
  { key: 'flyer',              label: 'Flyers' },
  { key: 'calculator',         label: 'Calculators' },
  { key: 'technical_bulletin', label: 'Technical bulletins' },
];

export default function ProductCatalogPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug;

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true); setError(null);
    getProductBySlug(slug)
      .then((p) => { if (!cancelled) setProduct(p); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  // Bucket files per category so each section can render its own grid.
  const filesByCategory: Record<FileCategory, ProductFile[]> = {
    presentation: [], flyer: [], calculator: [],
    technical_bulletin: [], document: [],
  };
  if (product) {
    // Skip placeholder rows (label set but URL blank) — admin
    // creates these when adding a file via the prompt flow and
    // intends to attach via the Upload button next. Hiding them
    // keeps the catalog view clean until the upload finishes.
    for (const f of product.files) {
      if (!f.url || !f.url.trim()) continue;
      filesByCategory[f.category].push(f);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar placeholder="Search CRM..." />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.back()}
            className="text-sm text-emerald-700 dark:text-emerald-400 hover:underline mb-4"
          >
            ← Back
          </button>

          {loading && <div className="py-16 text-center text-gray-400">Loading…</div>}
          {error && (
            <div className="p-4 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {!loading && !error && !product && (
            <div className="py-16 text-center">
              <p className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-2">Product not found</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Ask an admin to add this product via{' '}
                <Link href="/admin" className="text-emerald-700 dark:text-emerald-400 hover:underline">Admin → Product Library</Link>.
              </p>
            </div>
          )}

          {product && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-8 space-y-8">
              {/* ── Hero ──────────────────────────────────────────── */}
              <header>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{product.name}</h1>
                {product.tagline && (
                  <p className="mt-1 text-base text-gray-700 dark:text-gray-300">{product.tagline}</p>
                )}
                {product.description && (
                  <p className="mt-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {product.description}
                  </p>
                )}
              </header>

              {/* ── Product Information ───────────────────────────── */}
              {product.productInfo.rows.length > 0 && (
                <section>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">Product Information</h2>
                  <div className="border-t border-b border-gray-300 dark:border-slate-600">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-slate-700">
                          <th className="text-left px-3 py-2.5 w-[30%]"></th>
                          {product.productInfo.columns.map((col) => (
                            <th key={col} className="text-center px-3 py-2.5 font-semibold text-gray-900 dark:text-gray-100">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {product.productInfo.rows.map((row, i) => (
                          <tr key={i} className={i < product.productInfo.rows.length - 1 ? 'border-b border-gray-100 dark:border-slate-800' : ''}>
                            <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-gray-200">{row.label}</td>
                            {product.productInfo.columns.map((_, ci) => (
                              <td key={ci} className="px-3 py-2.5 text-center text-gray-700 dark:text-gray-300">
                                {row.values[ci] || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* ── Sales Tools ─────────────────────────────────────
                  Clean card grid. Empty categories are hidden so the
                  page doesn't display a wall of "—" placeholders.
                  Each file renders as a uniform card: thumbnail (or
                  file-type icon) + label + Download/Open action. */}
              <section>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Sales Tools</h2>

                {SALES_TOOL_SECTIONS.every((s) => filesByCategory[s.key].length === 0)
                  && filesByCategory.document.length === 0 && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                    No files uploaded yet.
                  </p>
                )}

                <div className="space-y-6">
                  {[...SALES_TOOL_SECTIONS, { key: 'document' as FileCategory, label: 'Documents' }].map((section) => {
                    const files = filesByCategory[section.key];
                    if (files.length === 0) return null;
                    return (
                      <div key={section.key}>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                          {section.label} <span className="text-gray-400 font-normal normal-case">· {files.length}</span>
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {files.map((f) => (
                            <FileCard key={f.id} file={f} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ── FileCard ─────────────────────────────────────────────────
// Uniform tile for every Sales Tools file. Either shows the admin-
// supplied thumbnail (image preview) or a filetype-specific icon
// derived from the filename / URL extension, then the label and a
// small Download/Open hint. The whole card is one <a> so clicking
// anywhere triggers the file.
function FileCard({ file }: { file: ProductFile }) {
  const uploaded = isUploadedProductFile(file.url);
  const ext = extensionOf(file.label || file.url).toLowerCase();
  const meta = FILE_TYPE_META[ext] ?? FILE_TYPE_META.default;

  return (
    <a
      href={file.url}
      target={uploaded ? undefined : '_blank'}
      rel="noopener noreferrer"
      download={uploaded ? file.label : undefined}
      title={uploaded ? `Download ${file.label}` : `Open ${file.url}`}
      className="group flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-emerald-400 hover:shadow-sm transition-all"
    >
      {/* Preview — thumbnail if the admin uploaded one, else a
          color-coded filetype square. Fixed size keeps every card
          the same height regardless of label length. */}
      {file.thumbnailUrl ? (
        <div className="flex-shrink-0 w-12 h-12 rounded border border-gray-200 dark:border-slate-700 overflow-hidden bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={file.thumbnailUrl} alt=""
               className="w-full h-full object-cover"
               onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
      ) : (
        <div className={`flex-shrink-0 w-12 h-12 rounded flex flex-col items-center justify-center ${meta.cls}`}>
          <span className="text-lg leading-none">{meta.icon}</span>
          <span className="text-[9px] font-bold tracking-wider mt-0.5">{ext.toUpperCase() || 'FILE'}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
          {file.label}
        </p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {uploaded ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            )}
          </svg>
          {uploaded ? 'Download' : 'Open link'}
        </p>
      </div>
    </a>
  );
}

function extensionOf(nameOrUrl: string): string {
  if (!nameOrUrl) return '';
  // Strip query strings/hashes before matching the extension.
  const clean = nameOrUrl.split(/[?#]/)[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1] : '';
}

const FILE_TYPE_META: Record<string, { icon: string; cls: string }> = {
  pdf:  { icon: '📕', cls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-100 dark:border-red-900/50' },
  doc:  { icon: '📘', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-100 dark:border-blue-900/50' },
  docx: { icon: '📘', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-100 dark:border-blue-900/50' },
  xls:  { icon: '📗', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/50' },
  xlsx: { icon: '📗', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/50' },
  csv:  { icon: '📗', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/50' },
  ppt:  { icon: '📙', cls: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border border-orange-100 dark:border-orange-900/50' },
  pptx: { icon: '📙', cls: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border border-orange-100 dark:border-orange-900/50' },
  png:  { icon: '🖼', cls: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-100 dark:border-purple-900/50' },
  jpg:  { icon: '🖼', cls: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-100 dark:border-purple-900/50' },
  jpeg: { icon: '🖼', cls: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-100 dark:border-purple-900/50' },
  zip:  { icon: '🗜', cls: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300 border border-gray-200 dark:border-slate-700' },
  default: { icon: '📄', cls: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300 border border-gray-200 dark:border-slate-700' },
};

// Suppress unused-import warning — next/image reserved for future use
// once we settle a remote-patterns policy for user-supplied URLs.
void Image;
