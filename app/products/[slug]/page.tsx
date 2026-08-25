'use client';

/**
 * Product catalog page — renders one product's PPT-style page
 * inside the CRM. Reads the row from Supabase on mount, no SSR so
 * we don't have to hoist Supabase creds into a server component.
 *
 * Layout mirrors "Product sheet on CRM_ver.1.02_20260806.pptx":
 *   ┌ hero (name / tagline / description)
 *   ├ Product Information table
 *   └ Sales Tools
 *       ├ Sales presentations   (file list)
 *       ├ Flyers                (file list)
 *       ├ Calculators           (file list)
 *       ├ Technical bulletins   (file list)
 *       └ Documents             (file list)
 *
 * Files are external links (Pathway Library URLs); clicking a
 * filename opens it in a new tab. The browser handles download vs
 * inline preview based on the file server's Content-Disposition.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import TopBar from '@/app/components/TopBar';
import { getProductBySlug, FILE_CATEGORY_META, type Product, type ProductFile, type FileCategory } from '@/lib/productCatalog';

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

  // Group files by category so each Sales Tools section can render
  // its own list. Categories with zero files are hidden.
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
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => router.back()}
            className="text-sm text-emerald-700 dark:text-emerald-400 hover:underline mb-4"
          >
            ← Back
          </button>

          {loading && (
            <div className="py-16 text-center text-gray-400">Loading…</div>
          )}
          {error && (
            <div className="p-4 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {!loading && !error && !product && (
            <div className="py-16 text-center">
              <p className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-2">Product not found</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                This product may have been removed. Ask an admin to add it via
                <Link href="/admin" className="text-emerald-700 dark:text-emerald-400 hover:underline"> Admin → Product Library</Link>.
              </p>
            </div>
          )}

          {product && (
            <>
              {/* Hero */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-6 mb-5">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{product.name}</h1>
                {product.tagline && (
                  <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400 font-medium">{product.tagline}</p>
                )}
                {product.description && (
                  <p className="mt-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{product.description}</p>
                )}
              </div>

              {/* Product Information */}
              {product.productInfo.rows.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-6 mb-5">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-3">Product Information</h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-slate-700">
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-[30%]"></th>
                        {product.productInfo.columns.map((col) => (
                          <th key={col} className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {product.productInfo.rows.map((row, i) => (
                        <tr key={i} className="border-b border-gray-50 dark:border-slate-800 last:border-b-0">
                          <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">{row.label}</td>
                          {product.productInfo.columns.map((_, ci) => (
                            <td key={ci} className="px-3 py-2 text-gray-900 dark:text-gray-100">{row.values[ci] || '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sales Tools */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-4">Sales Tools</h2>
                {FILE_CATEGORY_META.every((c) => filesByCategory[c.key].length === 0) && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                    No files uploaded yet. An admin can add downloads via
                    <Link href="/admin" className="text-emerald-700 dark:text-emerald-400 hover:underline"> Admin → Product Library</Link>.
                  </p>
                )}
                {FILE_CATEGORY_META.map((cat) => {
                  const files = filesByCategory[cat.key];
                  if (files.length === 0) return null;
                  return (
                    <div key={cat.key} className="mb-5 last:mb-0">
                      <h3 className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2">
                        <span className="mr-1.5">{cat.emoji}</span>{cat.label}
                      </h3>
                      <ul className="space-y-1">
                        {files.map((f) => (
                          <li key={f.id}>
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400 hover:underline"
                              title={`Open ${f.url}`}
                            >
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
                              </svg>
                              {f.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
