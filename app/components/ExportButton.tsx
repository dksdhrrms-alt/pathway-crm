'use client';

import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';

export interface ExportColumn<T> {
  id: string;
  label: string;
  getValue: (row: T) => string | number | null | undefined;
}

interface ExportButtonProps<T> {
  filename: string;
  columns: ExportColumn<T>[];
  rows: T[];
  title?: string;
}

export default function ExportButton<T>({ filename, columns, rows, title }: ExportButtonProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function buildAOA(): (string | number)[][] {
    const header = columns.map((c) => c.label);
    const body = rows.map((row) => columns.map((c) => {
      const v = c.getValue(row);
      return v == null ? '' : v;
    }));
    return [header, ...body];
  }

  function exportExcel() {
    const aoa = buildAOA();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Auto-size columns based on content length
    const colWidths = columns.map((_, idx) => {
      const lens = aoa.map((row) => String(row[idx] ?? '').length);
      const max = Math.max(...lens, 8);
      return { wch: Math.min(max + 2, 50) };
    });
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title || 'Sheet1');
    XLSX.writeFile(wb, `${filename}.xlsx`);
    setOpen(false);
  }

  function exportCSV() {
    const aoa = buildAOA();
    const csv = aoa.map((row) => row.map((cell) => {
      const s = String(cell ?? '');
      // Escape: wrap in quotes if contains comma, quote, or newline
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }).join(',')).join('\r\n');
    // BOM for Excel UTF-8 detection
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  function exportPDF() {
    const aoa = buildAOA();
    const docTitle = title || filename;
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const headerHtml = `<tr>${aoa[0].map((h) => `<th>${escapeHtml(String(h))}</th>`).join('')}</tr>`;
    const bodyHtml = aoa.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell ?? ''))}</td>`).join('')}</tr>`).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(docTitle)}</title>
<style>
  @page { size: landscape; margin: 0.5in; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1f2937; padding: 0; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px 0; color: #1a4731; }
  .meta { font-size: 11px; color: #6b7280; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #1a4731; color: white; text-align: left; padding: 6px 8px; font-weight: 600; }
  td { border-bottom: 1px solid #e5e7eb; padding: 5px 8px; vertical-align: top; }
  tr:nth-child(even) td { background: #f9fafb; }
  tfoot td { font-weight: 600; background: #f3f4f6; }
</style>
</head>
<body>
<h1>${escapeHtml(docTitle)}</h1>
<div class="meta">Generated ${escapeHtml(today)} · ${rows.length} record${rows.length !== 1 ? 's' : ''}</div>
<table>
  <thead>${headerHtml}</thead>
  <tbody>${bodyHtml}</tbody>
</table>
<script>window.addEventListener('load', () => { setTimeout(() => window.print(), 200); });<\/script>
</body>
</html>`;

    const w = window.open('', '_blank', 'width=1200,height=800');
    if (!w) {
      alert('Please allow popups to export PDF');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Export
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-30 py-1">
          <button onClick={exportExcel} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
            <span className="inline-block w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center" style={{ backgroundColor: '#1a7d3a' }}>X</span>
            Excel (.xlsx)
          </button>
          <button onClick={exportCSV} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
            <span className="inline-block w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center" style={{ backgroundColor: '#6b7280' }}>C</span>
            CSV (.csv)
          </button>
          <button onClick={exportPDF} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
            <span className="inline-block w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center" style={{ backgroundColor: '#dc2626' }}>P</span>
            PDF (print)
          </button>
          <div className="border-t border-gray-100 mt-1 pt-1 px-3 pb-1">
            <p className="text-[10px] text-gray-400">{rows.length} record{rows.length !== 1 ? 's' : ''} · {columns.length} column{columns.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
