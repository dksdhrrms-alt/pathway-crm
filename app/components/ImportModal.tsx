'use client';

import { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { generateId, Account } from '@/lib/data';
import { parseImportFile, autoMapColumns, RawRow, generateAccountTemplate, generateContactTemplate, parseMondayCompanies, parseMondayContacts, ParsedAccount, ParsedContact, fuzzyMatchUser } from '@/lib/importParser';

type ImportType = 'accounts' | 'contacts';
type Step = 'upload' | 'mapping' | 'preview' | 'done';
type DuplicateMode = 'skip' | 'update' | 'new';

interface Props {
  type: ImportType;
  onClose: () => void;
  onDone: (count: number) => void;
}

const ACCOUNT_FIELDS = ['name', 'industry', 'location', 'annualRevenue', 'website', 'ownerName', 'country', 'phone'];
const CONTACT_FIELDS = ['firstName', 'lastName', 'title', 'accountName', 'phone', 'email', 'linkedIn'];

export default function ImportModal({ type, onClose, onDone }: Props) {
  const { data: session } = useSession();
  const { accounts, addAccount, contacts, addContact } = useCRM();
  const { users } = useUsers();
  const activeUsers = users.filter((u) => u.status === 'active');

  // Resolve a CRM user from (a) the explicit "Sales" column, then (b) the name
  // extracted from the Q (Date) column. Returns the matched user or null.
  function resolveOwner(rawSalesName: string, fromDateName: string) {
    return fuzzyMatchUser(rawSalesName, activeUsers) || fuzzyMatchUser(fromDateName, activeUsers);
  }
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dupMode, setDupMode] = useState<DuplicateMode>('skip');
  const [result, setResult] = useState({ imported: 0, skipped: 0, errors: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [mondayAccounts, setMondayAccounts] = useState<ParsedAccount[]>([]);
  const [mondayContacts, setMondayContacts] = useState<ParsedContact[]>([]);
  const [isMondayMode, setIsMondayMode] = useState(false);

  const fields = type === 'accounts' ? ACCOUNT_FIELDS : CONTACT_FIELDS;

  function handleFile(f: File) {
    if (!f.name.match(/\.(xlsx?|csv)$/i)) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const buf = e.target?.result as ArrayBuffer;

      // Try Monday.com dedicated parsers first for Excel files
      if (f.name.match(/\.xlsx?$/i)) {
        try {
          if (type === 'accounts') {
            const parsed = parseMondayCompanies(buf);
            if (parsed.length > 10) {
              console.log(`[Import] Monday.com companies detected: ${parsed.length}`);
              setMondayAccounts(parsed);
              setIsMondayMode(true);
              setStep('preview');
              return;
            }
          } else {
            const parsed = parseMondayContacts(buf);
            if (parsed.length > 10) {
              console.log(`[Import] Monday.com contacts detected: ${parsed.length}`);
              setMondayContacts(parsed);
              setIsMondayMode(true);
              setStep('preview');
              return;
            }
          }
        } catch (err) {
          console.log('[Import] Not a Monday.com file, using standard parser', err);
        }
      }

      // Standard parser
      const { headers: h, rows: r } = parseImportFile(buf, f.name);
      setHeaders(h);
      setRows(r);
      setMapping(autoMapColumns(h, type));
      setIsMondayMode(false);
      setStep('mapping');
    };
    reader.readAsArrayBuffer(f);
  }

  function getMapped(row: RawRow, field: string): string {
    const col = Object.entries(mapping).find(([, v]) => v === field)?.[0];
    return col ? String(row[col] ?? '').trim() : '';
  }

  function doImport() {
    let imported = 0, skipped = 0, errors = 0;
    const userId = session?.user?.id ?? '';

    if (isMondayMode) {
      // Monday.com dedicated import
      if (type === 'accounts') {
        for (const ma of mondayAccounts) {
          const existing = accounts.find((a) => a.name.toLowerCase() === ma.name.toLowerCase());
          if (existing && dupMode === 'skip') { skipped++; continue; }
          const matched = resolveOwner(ma.ownerName, ma.ownerNameFromDate);
          addAccount({
            id: generateId(), name: ma.name,
            industry: ma.industry as Account['industry'],
            location: ma.location, annualRevenue: 0,
            website: ma.website,
            ownerId: matched?.id ?? userId,
            ownerName: matched?.name ?? (ma.ownerName || ma.ownerNameFromDate),
            country: ma.country,
            phone: ma.phone, employee: ma.employee,
            category: ma.category, createdAt: ma.createdAt,
            contactIds: [], opportunityIds: [],
          });
          imported++;
        }
      } else {
        for (const mc of mondayContacts) {
          if (!mc.firstName) { errors++; continue; }
          if (mc.email && contacts.find((c) => c.email.toLowerCase() === mc.email.toLowerCase())) {
            if (dupMode === 'skip') { skipped++; continue; }
          }
          const matchedAccount = accounts.find((a) => a.name.toLowerCase() === mc.accountName.toLowerCase());
          const matched = resolveOwner(mc.ownerName, mc.ownerNameFromDate);
          addContact({
            id: generateId(), firstName: mc.firstName, lastName: mc.lastName,
            title: mc.position || mc.species || '',
            species: mc.species, accountId: matchedAccount?.id ?? '',
            accountName: mc.accountName, country: mc.country,
            ownerName: matched?.name ?? (mc.ownerName || mc.ownerNameFromDate),
            position: mc.position,
            isKeyMan: mc.isKeyMan, phone: mc.phone, tel: mc.tel,
            email: mc.email,
            ownerId: matched?.id ?? userId,
            createdAt: mc.createdAt, status: mc.status,
          });
          imported++;
        }
      }
    } else {
      // Standard import
      if (type === 'accounts') {
        for (const row of rows) {
          const name = getMapped(row, 'name');
          if (!name) { errors++; continue; }
          const existing = accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
          if (existing && dupMode === 'skip') { skipped++; continue; }
          const ownerNameRaw = getMapped(row, 'ownerName');
          const matched = fuzzyMatchUser(ownerNameRaw, activeUsers);
          addAccount({
            id: generateId(), name,
            industry: (getMapped(row, 'industry') || 'Other') as Account['industry'],
            location: getMapped(row, 'location') || '',
            annualRevenue: parseInt(String(getMapped(row, 'annualRevenue')).replace(/[^0-9]/g, '')) || 0,
            website: getMapped(row, 'website') || '',
            country: getMapped(row, 'country') || '',
            phone: getMapped(row, 'phone') || '',
            ownerId: matched?.id ?? userId,
            ownerName: matched?.name ?? ownerNameRaw,
            contactIds: [], opportunityIds: [],
          });
          imported++;
        }
      } else {
        for (const row of rows) {
          let firstName = getMapped(row, 'firstName');
          let lastName = getMapped(row, 'lastName');
          if (firstName && !lastName) {
            const parts = firstName.split(/\s+/);
            firstName = parts[0] || '';
            lastName = parts.slice(1).join(' ') || '';
          }
          if (!firstName) { errors++; continue; }
          const email = getMapped(row, 'email');
          if (email && contacts.find((c) => c.email.toLowerCase() === email.toLowerCase())) {
            if (dupMode === 'skip') { skipped++; continue; }
          }
          const accountName = getMapped(row, 'accountName');
          const matchedAccount = accounts.find((a) => a.name.toLowerCase() === accountName.toLowerCase());
          const ownerNameRaw = getMapped(row, 'ownerName');
          const matched = fuzzyMatchUser(ownerNameRaw, activeUsers);
          addContact({
            id: generateId(), firstName, lastName,
            title: getMapped(row, 'title') || '',
            accountId: matchedAccount?.id ?? '',
            phone: getMapped(row, 'phone') || '',
            email: email || '',
            linkedIn: getMapped(row, 'linkedIn') || undefined,
            ownerId: matched?.id ?? userId,
            ownerName: matched?.name ?? ownerNameRaw,
          });
          imported++;
        }
      }
    }
    setResult({ imported, skipped, errors });
    setStep('done');
    onDone(imported);
  }

  function downloadTemplate() {
    const buf = type === 'accounts' ? generateAccountTemplate() : generateContactTemplate();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${type}-template.xlsx`; a.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Import {type === 'accounts' ? 'Accounts' : 'Contacts'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${dragOver ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-gray-400'}`}
            >
              <svg className="w-10 h-10 text-gray-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-medium text-gray-700">Drag & drop your file here, or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">Accepts .xlsx, .xls, .csv</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
            </div>
            <button onClick={downloadTemplate} className="mt-3 text-sm font-medium hover:underline" style={{ color: '#1a4731' }}>
              Download Template
            </button>
          </div>
        )}

        {/* Step 2: Mapping */}
        {step === 'mapping' && (
          <div>
            <p className="text-sm text-gray-500 mb-4">Map your file columns to CRM fields. {rows.length} rows found.</p>
            <div className="space-y-2 mb-4">
              {headers.filter((h) => h).map((h) => (
                <div key={h} className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 w-40 truncate">{h}</span>
                  <span className="text-gray-400">→</span>
                  <select
                    value={mapping[h] || ''}
                    onChange={(e) => setMapping((p) => ({ ...p, [h]: e.target.value }))}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">— Skip —</option>
                    {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setStep('upload')} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Back</button>
              <button onClick={() => setStep('preview')} className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>
                Next: Preview
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <div>
            <p className="text-sm text-gray-500 mb-3">
              {isMondayMode
                ? `${type === 'accounts' ? mondayAccounts.length : mondayContacts.length} records ready to import (Monday.com format detected).`
                : `${rows.length} records ready to import.`}
            </p>
            <div className="overflow-x-auto mb-4">
              {isMondayMode ? (
                <table className="w-full text-xs">
                  <thead><tr className="border-b bg-gray-50">
                    {type === 'accounts'
                      ? ['Name','Industry','Owner','Country','Phone','Website'].map((h) => <th key={h} className="text-left px-2 py-1.5 font-medium text-gray-500">{h}</th>)
                      : ['Name','Species','Company','Country','Position','Key','Email'].map((h) => <th key={h} className="text-left px-2 py-1.5 font-medium text-gray-500">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {(type === 'accounts' ? mondayAccounts : mondayContacts).slice(0, 10).map((r, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        {type === 'accounts' ? (
                          <>{[('name' in r ? r.name : ''), ('industry' in r ? (r as ParsedAccount).industry : ''), ('ownerName' in r ? (r as ParsedAccount).ownerName : ''), ('country' in r ? (r as ParsedAccount).country : ''), ('phone' in r ? r.phone : ''), ('website' in r ? (r as ParsedAccount).website : '')].map((v, j) => <td key={j} className="px-2 py-1.5 text-gray-700 truncate max-w-[100px]">{v || '—'}</td>)}</>
                        ) : (
                          <>{[`${(r as ParsedContact).firstName} ${(r as ParsedContact).lastName}`, (r as ParsedContact).species, (r as ParsedContact).accountName, (r as ParsedContact).country, (r as ParsedContact).position, (r as ParsedContact).isKeyMan ? '★' : '☆', (r as ParsedContact).email].map((v, j) => <td key={j} className="px-2 py-1.5 text-gray-700 truncate max-w-[100px]">{String(v) || '—'}</td>)}</>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="border-b bg-gray-50">
                    {fields.filter((f) => Object.values(mapping).includes(f)).map((f) => (
                      <th key={f} className="text-left px-2 py-1.5 font-medium text-gray-500">{f}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {rows.slice(0, 10).map((row, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        {fields.filter((f) => Object.values(mapping).includes(f)).map((f) => (
                          <td key={f} className="px-2 py-1.5 text-gray-700 truncate max-w-[120px]">{getMapped(row, f) || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!isMondayMode && rows.length > 10 && <p className="text-xs text-gray-400 text-center py-1">...and {rows.length - 10} more</p>}
              {isMondayMode && (type === 'accounts' ? mondayAccounts : mondayContacts).length > 10 && <p className="text-xs text-gray-400 text-center py-1">...and {(type === 'accounts' ? mondayAccounts : mondayContacts).length - 10} more</p>}
            </div>
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Duplicate handling:</p>
              <div className="flex gap-4">
                {(['skip', 'update', 'new'] as DuplicateMode[]).map((m) => (
                  <label key={m} className="flex items-center gap-1.5 text-sm text-gray-600">
                    <input type="radio" name="dup" checked={dupMode === m} onChange={() => setDupMode(m)} className="text-green-600" />
                    {m === 'skip' ? 'Skip duplicates' : m === 'update' ? 'Update existing' : 'Import as new'}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setStep(isMondayMode ? 'upload' : 'mapping')} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Back</button>
              <button onClick={doImport} className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>
                Import {isMondayMode ? (type === 'accounts' ? mondayAccounts.length : mondayContacts.length) : rows.length} Records
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && (
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 mb-4">
              <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Import Complete!</h3>
            <div className="flex justify-center gap-6 mb-4">
              <div><p className="text-2xl font-bold text-green-600">{result.imported}</p><p className="text-xs text-gray-500">Imported</p></div>
              <div><p className="text-2xl font-bold text-amber-500">{result.skipped}</p><p className="text-xs text-gray-500">Skipped</p></div>
              {result.errors > 0 && <div><p className="text-2xl font-bold text-red-500">{result.errors}</p><p className="text-xs text-gray-500">Errors</p></div>}
            </div>
            <button onClick={onClose} className="px-5 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
