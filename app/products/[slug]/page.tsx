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
import { getProductBySlug, type Product, type ProductFile, type FileCategory } from '@/lib/productCatalog';

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
    for (const f of product.files) filesByCategory[f.category].push(f);
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

              {/* ── Sales Tools ───────────────────────────────────── */}
              <section>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Sales Tools</h2>

                {SALES_TOOL_SECTIONS.every((s) => filesByCategory[s.key].length === 0)
                  && filesByCategory.document.length === 0 && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                    No files uploaded yet. An admin can add downloads via{' '}
                    <Link href="/admin" className="text-emerald-700 dark:text-emerald-400 hover:underline">Admin → Product Library</Link>.
                  </p>
                )}

                {/* 4 categories in a 2x2 grid — same shape as the PPT. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {SALES_TOOL_SECTIONS.map((section) => {
                    const files = filesByCategory[section.key];
                    return (
                      <div key={section.key} className="space-y-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{section.label}</h3>
                        {files.length === 0 ? (
                          <p className="text-xs text-gray-400 dark:text-gray-500 italic">—</p>
                        ) : (
                          <ul className="space-y-3">
                            {files.map((f) => (
                              <li key={f.id} className="flex items-start gap-3">
                                {f.thumbnailUrl && (
                                  <a href={f.url} target="_blank" rel="noopener noreferrer"
                                     className="flex-shrink-0 block w-24 h-24 border border-gray-200 dark:border-slate-700 rounded overflow-hidden bg-white">
                                    {/* Regular <img> instead of next/image so
                                        admin can drop in any external URL
                                        (Pathway Library, S3, etc.) without
                                        adding remote patterns to next.config. */}
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={f.thumbnailUrl} alt=""
                                         className="w-full h-full object-cover"
                                         onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                  </a>
                                )}
                                <div className="flex-1 min-w-0 pt-1">
                                  <a href={f.url} target="_blank" rel="noopener noreferrer"
                                     className="text-sm text-blue-700 dark:text-blue-400 hover:underline break-all"
                                     title={`Open ${f.url}`}>
                                    {f.label}
                                  </a>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Documents — full-width, multi-column list matching
                    the PPT bottom section (Lipidol Prime / Ultra /
                    Gold docs side-by-side). CSS multi-column keeps
                    it simple; when the list is short it collapses to
                    a single column automatically. */}
                {filesByCategory.document.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-gray-200 dark:border-slate-700">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Documents</h3>
                    <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1 columns-1 md:columns-2 lg:columns-3 gap-6">
                      {filesByCategory.document.map((f) => (
                        <li key={f.id} className="break-inside-avoid">
                          <a href={f.url} target="_blank" rel="noopener noreferrer"
                             className="hover:underline break-all"
                             title={`Open ${f.url}`}>
                            {f.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// Suppress unused-import warning — next/image reserved for future use
// once we settle a remote-patterns policy for user-supplied URLs.
void Image;
