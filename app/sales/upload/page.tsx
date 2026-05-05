'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { generateId } from '@/lib/data';
import { parseExcelFile, findDuplicates, generateTemplate, SaleRecord, UploadHistoryEntry } from '@/lib/excelParser';
import { supabaseEnabled } from '@/lib/supabase';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export default function SalesUploadPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = session?.user?.role;
  const isAdmin = ['administrative_manager','admin','ceo','sales_director','coo'].includes(role ?? '');

  const { accounts, addAccount, addActivity, saleRecords: salesData, setSaleRecords: setSalesData, uploadHistory, setUploadHistory } = useCRM();
  const { users } = useUsers();

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [step, setStep] = useState<'idle' | 'reading' | 'preview' | 'importing' | 'done'>('idle');
  const [parsed, setParsed] = useState<{ records: SaleRecord[]; errors: { row: number; reason: string }[]; totalRows: number } | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; newAccounts: string[]; autoLinkedToParent: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'single'; entry: UploadHistoryEntry } | { type: 'all' } | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [showSkipped, setShowSkipped] = useState(false);
  const [skippedRecords, setSkippedRecords] = useState<SaleRecord[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function saveSalesData(data: SaleRecord[]) {
    setSalesData(data);
    if (supabaseEnabled) {
      import('@/lib/db').then(({ dbCreateSaleRecords }) => {
        const newOnes = data.filter((d) => !salesData.some((s) => s.id === d.id));
        if (newOnes.length > 0) dbCreateSaleRecords(newOnes).catch(console.error);
      });
    } else {
      try { localStorage.setItem('sales_records', JSON.stringify(data)); } catch { /* */ }
    }
  }

  function saveHistory(h: UploadHistoryEntry[]) {
    setUploadHistory(h);
    if (supabaseEnabled) {
      const newest = h[0];
      if (newest) import('@/lib/db').then(({ dbCreateUploadHistory }) => dbCreateUploadHistory(newest).catch(console.error));
    } else {
      try { localStorage.setItem('sales_upload_history', JSON.stringify(h)); } catch { /* */ }
    }
  }

  const handleFile = useCallback((f: File) => {
    if (!f.name.match(/\.xlsx?$/i)) { setToast('Please upload an Excel file (.xlsx or .xls)'); return; }
    setFile(f);
    setStep('reading');
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      const result = parseExcelFile(buffer);
      setParsed(result);
      setStep('preview');
    };
    reader.readAsArrayBuffer(f);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }

  function handleConfirmImport() {
    if (!parsed) return;
    setStep('importing');

    const batchId = `batch-${Date.now()}`;
    const { unique, duplicates } = findDuplicates(parsed.records, salesData, skipDuplicates);
    setSkippedRecords(duplicates);

    // Assign batchId to all records
    const tagged = unique.map((r) => ({ ...r, uploadBatchId: batchId }));

    // Auto-create accounts — and try to infer Integration parent linkage from name patterns
    // (e.g. "Pilgrim's_Moorefield WV Feed Mill" → parent "Pilgrim's" if such an account exists).
    const existingAccountNames = new Set(accounts.map((a) => a.name.toLowerCase()));
    const newAccounts: string[] = [];
    let autoLinkedToParent = 0;

    function inferParentId(name: string): string {
      const lower = name.toLowerCase();
      // 1) Split-based: prefix before _ / " - " / " – " maps to an existing account
      const splitCandidates = [name.split('_')[0], name.split(' - ')[0], name.split(' – ')[0]]
        .map((s) => s.trim())
        .filter((s) => s && s.length >= 3 && s.toLowerCase() !== lower);
      for (const cand of splitCandidates) {
        const m = accounts.find((a) => a.name.toLowerCase() === cand.toLowerCase() && !a.parentAccountId);
        if (m) return m.id;
      }
      // 2) Prefix match: existing account's name is a prefix of this name (followed by _ or space)
      let best: typeof accounts[number] | null = null;
      let bestLen = 0;
      for (const a of accounts) {
        if (a.parentAccountId) continue; // only link to top-level parents
        const an = a.name.toLowerCase();
        if (an === lower) continue;
        if (an.length < 3) continue;
        if (lower.startsWith(an + '_') || lower.startsWith(an + ' ')) {
          if (an.length > bestLen) { bestLen = an.length; best = a; }
        }
      }
      return best?.id || '';
    }

    for (const r of tagged) {
      const lower = r.accountName.toLowerCase();
      if (!existingAccountNames.has(lower) && r.accountName) {
        existingAccountNames.add(lower);
        newAccounts.push(r.accountName);
        const matchedUser = users.find((u) => u.name.toLowerCase() === r.ownerName.toLowerCase());
        const parentId = inferParentId(r.accountName);
        if (parentId) autoLinkedToParent += 1;
        addAccount({
          id: generateId(), name: r.accountName,
          industry: r.category === 'ruminants' ? 'Beef' : r.category === 'latam' ? 'Distributor' : 'Poultry',
          location: r.state ? `${r.state}, USA` : 'USA', annualRevenue: 0,
          ownerId: matchedUser?.id ?? session?.user?.id ?? '',
          website: '', contactIds: [], opportunityIds: [],
          parentAccountId: parentId || undefined,
        });
      }
    }

    saveSalesData([...salesData, ...tagged]);

    addActivity({
      id: generateId(), type: 'Note',
      subject: `[SYSTEM] Sales data uploaded — ${tagged.length} records imported`,
      description: `File: ${file?.name}. ${tagged.length} imported, ${duplicates.length} duplicates skipped.`,
      date: new Date().toISOString().split('T')[0],
      ownerId: session?.user?.id ?? '', accountId: '',
    });

    const entry: UploadHistoryEntry = {
      id: batchId,
      uploadedAt: new Date().toISOString(),
      uploadedBy: session?.user?.name ?? 'Unknown',
      fileName: file?.name ?? 'unknown.xlsx',
      recordCount: tagged.length,
      skippedCount: duplicates.length,
    };
    saveHistory([entry, ...uploadHistory]);
    setImportResult({ imported: tagged.length, skipped: duplicates.length, newAccounts, autoLinkedToParent });
    setStep('done');
  }

  async function handleDeleteSingle(entry: UploadHistoryEntry) {
    try {
      if (supabaseEnabled) {
        const { dbDeleteSaleRecordsByBatch, dbDeleteUploadHistory } = await import('@/lib/db');
        await dbDeleteSaleRecordsByBatch(entry.id);
        await dbDeleteUploadHistory(entry.id);
      }
      setSalesData((prev) => prev.filter((r) => r.uploadBatchId !== entry.id));
      setUploadHistory((prev) => prev.filter((h) => h.id !== entry.id));
      setDeleteConfirm(null);
      setToast(`Upload deleted — ${entry.recordCount} records removed`);
    } catch (err) {
      console.error('Delete error:', err);
      setToast('Failed to delete. Please try again.');
    }
  }

  async function handleDeleteAll() {
    try {
      if (supabaseEnabled) {
        const { dbDeleteAllSaleRecords, dbDeleteAllUploadHistory } = await import('@/lib/db');
        await dbDeleteAllSaleRecords();
        await dbDeleteAllUploadHistory();
      }
      setSalesData([]);
      setUploadHistory([]);
      setDeleteConfirm(null);
      setToast('All sales data cleared');
    } catch (err) {
      console.error('Clear all error:', err);
      setToast('Failed to clear. Please try again.');
    }
  }

  function handleDownloadTemplate() {
    const buf = generateTemplate();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'sales-template.xlsx'; a.click();
  }

  function reset() {
    setFile(null); setStep('idle'); setParsed(null); setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  if (!isAdmin) return <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center"><p className="text-gray-500 dark:text-gray-400">Admin access required.</p></div>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-5xl mx-auto">
          <div className="mt-6 mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Upload Sales Data</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Import weekly sales report Excel files</p>
            </div>
            <button onClick={handleDownloadTemplate} className="px-4 py-2 text-sm font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800/60">
              Download Template
            </button>
          </div>

          {/* Upload Zone */}
          {step === 'idle' && (
            <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`bg-white dark:bg-slate-900 rounded-xl border-2 border-dashed p-16 text-center cursor-pointer transition-colors ${dragOver ? 'border-green-400 bg-green-50 dark:bg-green-950/40' : 'border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'}`}>
              <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              <p className="text-base font-medium text-gray-700 dark:text-gray-200">Drag & drop your Excel file here, or click to browse</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Accepts .xlsx and .xls files</p>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
            </div>
          )}

          {step === 'reading' && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-12 text-center">
              <div className="inline-block w-8 h-8 border-3 border-gray-200 dark:border-slate-700 border-t-[#1a4731] rounded-full animate-spin mb-4" />
              <p className="text-sm text-gray-700 dark:text-gray-200 font-medium">Reading file...</p>
            </div>
          )}

          {/* Preview */}
          {step === 'preview' && parsed && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <div><h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Preview</h2><p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{parsed.records.length} valid — {parsed.errors.length} skipped</p></div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                      <th className="text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Date</th><th className="text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Account</th>
                      <th className="text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Product</th><th className="text-right px-3 py-2 text-xs text-gray-500 dark:text-gray-400">KG</th>
                      <th className="text-right px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Amount</th><th className="text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Category</th>
                    </tr></thead>
                    <tbody>{parsed.records.slice(0, 10).map((r, i) => (
                      <tr key={i} className="border-b border-gray-50 dark:border-slate-700"><td className="px-3 py-2 dark:text-gray-300">{r.date}</td><td className="px-3 py-2 font-medium dark:text-gray-100">{r.accountName}</td>
                        <td className="px-3 py-2 dark:text-gray-300">{r.productName}</td><td className="px-3 py-2 text-right dark:text-gray-300">{r.volumeKg.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-medium dark:text-gray-100">{formatCurrency(r.amount)}</td><td className="px-3 py-2 text-xs dark:text-gray-400">{r.category}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 mr-auto">
                  <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} className="rounded border-gray-300 dark:border-slate-600 dark:bg-slate-800 text-green-600" />
                  Skip duplicate records
                </label>
                <button onClick={reset} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700">Cancel</button>
                <button onClick={handleConfirmImport} className="px-5 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>
                  Confirm Import ({parsed.records.length} records)
                </button>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-12 text-center">
              <div className="inline-block w-8 h-8 border-3 border-gray-200 dark:border-slate-700 border-t-[#1a4731] rounded-full animate-spin mb-4" />
              <p className="text-sm text-gray-700 dark:text-gray-200 font-medium">Processing records...</p>
            </div>
          )}

          {/* Done */}
          {step === 'done' && importResult && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-8 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/40 mb-4">
                <svg className="w-7 h-7 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Import Complete</h2>
              <div className="flex justify-center gap-8 my-4">
                <div><p className="text-3xl font-bold text-green-600 dark:text-green-400">{importResult.imported}</p><p className="text-xs text-gray-500 dark:text-gray-400">Imported</p></div>
                <div><p className="text-3xl font-bold text-amber-500 dark:text-amber-400">{importResult.skipped}</p><p className="text-xs text-gray-500 dark:text-gray-400">Skipped</p></div>
              </div>
              {importResult.newAccounts.length > 0 && (
                <div className="bg-blue-50 dark:bg-blue-900/40 rounded-lg px-4 py-3 mb-4 text-sm text-blue-800 dark:text-blue-300 text-left">
                  <strong>{importResult.newAccounts.length} new accounts created:</strong> {importResult.newAccounts.join(', ')}
                  {importResult.autoLinkedToParent > 0 && (
                    <p className="mt-1.5 text-xs text-blue-700 dark:text-blue-400">◆ {importResult.autoLinkedToParent} auto-linked to a parent Integration based on name pattern (e.g. <code>Pilgrim&apos;s_Moorefield</code> → Pilgrim&apos;s)</p>
                  )}
                </div>
              )}
              {skippedRecords.length > 0 && (
                <div className="mb-4 text-left">
                  <button onClick={() => setShowSkipped(!showSkipped)} className="text-sm font-medium text-amber-600 dark:text-amber-400 hover:underline">
                    {importResult.skipped} skipped — {showSkipped ? 'hide' : 'click to view'}
                  </button>
                  {showSkipped && (
                    <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                      <table className="w-full text-xs">
                        <thead><tr className="bg-gray-50 dark:bg-slate-800 border-b dark:border-slate-700"><th className="px-3 py-1.5 text-left text-gray-500 dark:text-gray-400">Date</th><th className="px-3 py-1.5 text-left text-gray-500 dark:text-gray-400">Account</th><th className="px-3 py-1.5 text-left text-gray-500 dark:text-gray-400">Product</th><th className="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400">Amount</th><th className="px-3 py-1.5 text-left text-gray-500 dark:text-gray-400">Reason</th></tr></thead>
                        <tbody>{skippedRecords.map((r, i) => (
                          <tr key={i} className="border-b border-gray-50 dark:border-slate-700"><td className="px-3 py-1 dark:text-gray-300">{r.date}</td><td className="px-3 py-1 dark:text-gray-300">{r.accountName}</td><td className="px-3 py-1 dark:text-gray-300">{r.productName}</td><td className="px-3 py-1 text-right dark:text-gray-300">${r.amount.toLocaleString()}</td><td className="px-3 py-1 text-amber-600 dark:text-amber-400">Duplicate</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-center gap-3">
                <button onClick={reset} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700">Upload Another</button>
                <button onClick={() => router.push('/sales')} className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>View Sales Data</button>
              </div>
            </div>
          )}

          {/* Upload History */}
          {uploadHistory.length > 0 && (
            <div className="mt-8 bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Upload History</h2>
                <button onClick={() => setDeleteConfirm({ type: 'all' })} className="px-3 py-1.5 text-xs font-medium border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/40">
                  Clear All History
                </button>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Uploaded By</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">File</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Imported</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Skipped</th>
                  <th className="w-10 px-3 py-3"></th>
                </tr></thead>
                <tbody>
                  {uploadHistory.map((h) => (
                    <tr key={h.id} className="border-b border-gray-50 dark:border-slate-700 group">
                      <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{formatDate(h.uploadedAt)}</td>
                      <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{h.uploadedBy}</td>
                      <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{h.fileName}</td>
                      <td className="px-5 py-3 text-right font-medium text-green-600 dark:text-green-400">{h.recordCount}</td>
                      <td className="px-5 py-3 text-right text-gray-400 dark:text-gray-500">{h.skippedCount}</td>
                      <td className="px-3 py-3">
                        <button onClick={() => setDeleteConfirm({ type: 'single', entry: h })}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/40">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {deleteConfirm.type === 'all' ? 'Clear all upload history?' : 'Delete this upload record?'}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
              {deleteConfirm.type === 'all'
                ? `This will permanently delete ALL ${salesData.length} sale records across all uploads. Sales Dashboard will be reset to zero. This cannot be undone.`
                : `This will remove ${deleteConfirm.entry.recordCount} sale records imported from "${deleteConfirm.entry.fileName}". This cannot be undone.`}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700">Cancel</button>
              <button onClick={() => deleteConfirm.type === 'all' ? handleDeleteAll() : handleDeleteSingle(deleteConfirm.entry)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600">
                {deleteConfirm.type === 'all' ? 'Clear All' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
