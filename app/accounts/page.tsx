'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Account } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import TopBar from '@/app/components/TopBar';
import NewAccountModal from '@/app/components/NewAccountModal';
import Toast from '@/app/components/Toast';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import ImportModal from '@/app/components/ImportModal';
import EditAccountModal from '@/app/components/EditAccountModal';
import ExportButton, { ExportColumn } from '@/app/components/ExportButton';

const FLAGS: Record<string, string> = {
  USA: '🇺🇸', Mexico: '🇲🇽', Colombia: '🇨🇴', Peru: '🇵🇪', Panama: '🇵🇦',
  'El Salvador': '🇸🇻', UK: '🇬🇧', Korea: '🇰🇷', Guatemala: '🇬🇹',
  Brazil: '🇧🇷', Ecuador: '🇪🇨', Bolivia: '🇧🇴',
};

const COUNTRY_LIST = ['USA','Mexico','Colombia','Peru','Panama','El Salvador','Guatemala','Brazil','Ecuador','Bolivia','Chile','Dominican Republic','Jamaica','Korea','UK'];

const INDUSTRY_LIST = ['Dairy/Beef','Dairy','Beef','Poultry','Swine','Feed Mill','Aquaculture','Multi-Species','Veterinary Hospital','Veterinary Clinic','Distributor','Research','University','Other'];

const COMPANY_TYPES = ['Producer','Integrator','Distributor','Premix Manufacturer','Feed Mill','Veterinary Group','Consulting Firm','Cooperative','Government / Regulator','Academic / Research','Other'];

const SPECIES_BADGE: Record<string, { bg: string; text: string }> = {
  'Dairy/Beef': { bg: '#E1F5EE', text: '#0F6E56' },
  Poultry: { bg: '#E6F1FB', text: '#185FA5' },
  Swine: { bg: '#FAEEDA', text: '#854F0B' },
  'Feed Mill': { bg: '#EEEDFE', text: '#534AB7' },
  Aquaculture: { bg: '#E1F5EE', text: '#085041' },
  'Multi-Species': { bg: '#F1EFE8', text: '#5F5E5A' },
  Research: { bg: '#F1EFE8', text: '#5F5E5A' },
  University: { bg: '#F1EFE8', text: '#5F5E5A' },
  Other: { bg: '#F1EFE8', text: '#5F5E5A' },
};

function stripUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function ownerInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type SortKey = 'name' | 'industry' | 'country' | 'employee' | 'openDeals' | 'pipelineValue' | 'companyType';
type SortDir = 'asc' | 'desc';

export default function AccountsPage() {
  const { data: session } = useSession();
  const isAdmin = ['administrative_manager', 'admin', 'ceo', 'sales_director', 'coo'].includes(session?.user?.role ?? '');
  const userId = session?.user?.id ?? '';

  const { accounts: allAccounts, contacts, opportunities, updateAccount, deleteAccount, deleteAccountsBulk, loading } = useCRM();
  const { users } = useUsers();
  const activeUsers = useMemo(() => users.filter((u) => u.status === 'active').sort((a, b) => a.name.localeCompare(b.name)), [users]);

  const accounts = allAccounts; // All users see all accounts

  const [search, setSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');

  // Column customization
  const ALL_COLUMNS = useMemo(() => [
    { id: 'name', label: 'Account Name', sortable: true, sortKey: 'name' as SortKey, defaultVisible: true, minWidth: 180 },
    { id: 'industry', label: 'Species', sortable: true, sortKey: 'industry' as SortKey, defaultVisible: true, minWidth: 150 },
    { id: 'companyType', label: 'Company Type', sortable: true, sortKey: 'companyType' as SortKey, defaultVisible: true, minWidth: 160 },
    { id: 'owner', label: 'Sales Owner', sortable: false, defaultVisible: true, minWidth: 160 },
    { id: 'country', label: 'Country', sortable: true, sortKey: 'country' as SortKey, defaultVisible: true, minWidth: 130 },
    { id: 'phone', label: 'Telephone', sortable: false, defaultVisible: true, minWidth: 130 },
    { id: 'employee', label: 'Employee', sortable: true, sortKey: 'employee' as SortKey, defaultVisible: true, align: 'right' as const, minWidth: 90 },
    { id: 'openDeals', label: 'Open Deals', sortable: true, sortKey: 'openDeals' as SortKey, defaultVisible: true, align: 'right' as const, minWidth: 110 },
    { id: 'pipelineValue', label: 'Pipeline', sortable: true, sortKey: 'pipelineValue' as SortKey, defaultVisible: true, align: 'right' as const, minWidth: 110 },
    { id: 'website', label: 'Website', sortable: false, defaultVisible: true, minWidth: 140 },
    { id: 'address', label: 'Address', sortable: false, defaultVisible: true, minWidth: 200 },
  ], []);
  const [columnOrder, setColumnOrder] = useState<string[]>(ALL_COLUMNS.map((c) => c.id));
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [showColMenu, setShowColMenu] = useState(false);
  const [draggedCol, setDraggedCol] = useState<string | null>(null);

  const colOrderKey = `accounts_col_order_${userId || 'anon'}`;
  const colHiddenKey = `accounts_col_hidden_${userId || 'anon'}`;

  useEffect(() => {
    try {
      const order = localStorage.getItem(colOrderKey);
      const hidden = localStorage.getItem(colHiddenKey);
      if (order) {
        const saved: string[] = JSON.parse(order);
        const all = ALL_COLUMNS.map((c) => c.id);
        // Append any new columns that aren't in saved order
        const merged = [...saved.filter((id) => all.includes(id)), ...all.filter((id) => !saved.includes(id))];
        setColumnOrder(merged);
      } else {
        setColumnOrder(ALL_COLUMNS.map((c) => c.id));
      }
      setHiddenColumns(hidden ? new Set(JSON.parse(hidden)) : new Set());
    } catch { /* */ }
  }, [ALL_COLUMNS, colOrderKey, colHiddenKey]);

  function saveCols(order: string[], hidden: Set<string>) {
    try {
      localStorage.setItem(colOrderKey, JSON.stringify(order));
      localStorage.setItem(colHiddenKey, JSON.stringify([...hidden]));
    } catch { /* */ }
  }
  function toggleColumn(id: string) {
    const next = new Set(hiddenColumns);
    if (next.has(id)) next.delete(id); else next.add(id);
    setHiddenColumns(next);
    saveCols(columnOrder, next);
  }
  function moveColumn(from: string, to: string) {
    if (from === to) return;
    const order = [...columnOrder];
    const fromIdx = order.indexOf(from);
    const toIdx = order.indexOf(to);
    if (fromIdx < 0 || toIdx < 0) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, from);
    setColumnOrder(order);
    saveCols(order, hiddenColumns);
  }
  function resetColumns() {
    setColumnOrder(ALL_COLUMNS.map((c) => c.id));
    setHiddenColumns(new Set());
    try { localStorage.removeItem(colOrderKey); localStorage.removeItem(colHiddenKey); } catch { /* */ }
  }
  const visibleCols = columnOrder.map((id) => ALL_COLUMNS.find((c) => c.id === id)!).filter((c) => c && !hiddenColumns.has(c.id));

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const ownerOptions = useMemo(() => {
    const ids = [...new Set(accounts.map((a) => a.ownerId).filter(Boolean))];
    return ids.map((id) => ({ id, name: users.find((u) => u.id === id)?.name || id })).sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts, users]);

  const dealsByAccount = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    opportunities.forEach((o) => {
      if (o.stage === 'Closed Won' || o.stage === 'Closed Lost') return;
      if (!o.accountId) return;
      if (!map[o.accountId]) map[o.accountId] = { count: 0, value: 0 };
      map[o.accountId].count += 1;
      map[o.accountId].value += o.amount || 0;
    });
    return map;
  }, [opportunities]);

  const filtered = useMemo(() => {
    let list = accounts.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));
    if (ownerFilter !== 'all') list = list.filter((a) => a.ownerId === ownerFilter);
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'industry': cmp = (a.industry || '').localeCompare(b.industry || ''); break;
        case 'country': cmp = (a.country || '').localeCompare(b.country || ''); break;
        case 'employee': cmp = (a.employee ?? 0) - (b.employee ?? 0); break;
        case 'companyType': cmp = (a.companyType || '').localeCompare(b.companyType || ''); break;
        case 'openDeals': cmp = (dealsByAccount[a.id]?.count ?? 0) - (dealsByAccount[b.id]?.count ?? 0); break;
        case 'pipelineValue': cmp = (dealsByAccount[a.id]?.value ?? 0) - (dealsByAccount[b.id]?.value ?? 0); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [accounts, search, sortKey, sortDir, ownerFilter, dealsByAccount]);

  const exportColumns: ExportColumn<typeof filtered[number]>[] = useMemo(() => [
    { id: 'name', label: 'Account Name', getValue: (a) => a.name },
    { id: 'industry', label: 'Species', getValue: (a) => a.industry || '' },
    { id: 'companyType', label: 'Company Type', getValue: (a) => a.companyType || '' },
    { id: 'owner', label: 'Sales Owner', getValue: (a) => a.ownerName || '' },
    { id: 'country', label: 'Country', getValue: (a) => a.country || '' },
    { id: 'phone', label: 'Telephone', getValue: (a) => a.phone || '' },
    { id: 'employee', label: 'Employee', getValue: (a) => a.employee ?? '' },
    { id: 'openDeals', label: 'Open Deals', getValue: (a) => dealsByAccount[a.id]?.count ?? 0 },
    { id: 'pipelineValue', label: 'Pipeline ($)', getValue: (a) => dealsByAccount[a.id]?.value ?? 0 },
    { id: 'website', label: 'Website', getValue: (a) => a.website || '' },
    { id: 'address', label: 'Address', getValue: (a) => a.location || '' },
  ], [dealsByAccount]);

  function handleDeleteConfirm() {
    if (!confirmDeleteId) return;
    deleteAccount(confirmDeleteId);
    setConfirmDeleteId(null);
    setToast('Account deleted');
  }

  function handleBulkDelete() {
    deleteAccountsBulk(Array.from(selectedIds));
    setToast(`${selectedIds.size} accounts deleted`);
    setSelectedIds(new Set());
    setShowBulkDelete(false);
  }

  const accountToDelete = confirmDeleteId ? accounts.find((a) => a.id === confirmDeleteId) : null;
  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar searchValue={search} onSearchChange={setSearch} placeholder="Search accounts..." />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
              <p className="text-sm text-gray-500 mt-0.5">{filtered.length} of {accounts.length} account{accounts.length !== 1 ? 's' : ''}{isAdmin ? ' total' : ''}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <ExportButton filename={`accounts-${new Date().toISOString().split('T')[0]}`} title="Accounts" columns={exportColumns} rows={filtered} />
              <button onClick={() => setShowImportModal(true)} className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">+ Import</button>
              <button onClick={() => setShowNewModal(true)} className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>+ New Account</button>
            </div>
          </div>

          {/* Filter bar */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Filter by Owner:</span>
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white min-w-[200px]">
              <option value="all">All Owners ({accounts.length})</option>
              {ownerOptions.map((o) => {
                const count = accounts.filter((a) => a.ownerId === o.id).length;
                return <option key={o.id} value={o.id}>{o.name} ({count})</option>;
              })}
            </select>
            {ownerFilter !== 'all' && (
              <button onClick={() => setOwnerFilter('all')} className="text-xs text-gray-500 hover:text-gray-700 underline">
                Clear filter
              </button>
            )}
            <div className="ml-auto relative">
              <button onClick={() => setShowColMenu(!showColMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
                Columns ({visibleCols.length}/{ALL_COLUMNS.length})
              </button>
              {showColMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 p-2">
                    <div className="flex items-center justify-between px-2 py-1.5 mb-1 border-b border-gray-100">
                      <span className="text-xs font-semibold text-gray-700">Columns</span>
                      <button onClick={resetColumns} className="text-xs text-blue-600 hover:underline">Reset</button>
                    </div>
                    <p className="text-[10px] text-gray-400 px-2 mb-1">Drag to reorder · Click to toggle</p>
                    <ul className="max-h-64 overflow-y-auto">
                      {columnOrder.map((id) => {
                        const col = ALL_COLUMNS.find((c) => c.id === id);
                        if (!col) return null;
                        const isHidden = hiddenColumns.has(id);
                        return (
                          <li key={id}
                            draggable
                            onDragStart={() => setDraggedCol(id)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => { if (draggedCol) moveColumn(draggedCol, id); setDraggedCol(null); }}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-move ${draggedCol === id ? 'opacity-50' : ''}`}>
                            <span className="text-gray-300 text-xs">⋮⋮</span>
                            <input type="checkbox" checked={!isHidden} onChange={() => toggleColumn(id)}
                              className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                            <span className={`text-sm flex-1 ${isHidden ? 'text-gray-400' : 'text-gray-700'}`}>{col.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="w-10 px-3 py-3">
                    <input type="checkbox" className="rounded border-gray-300"
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onChange={(e) => { if (e.target.checked) setSelectedIds(new Set(filtered.map((a) => a.id))); else setSelectedIds(new Set()); }} />
                  </th>
                  {visibleCols.map((col) => (
                    <th key={col.id}
                      className={`px-4 py-3 font-medium text-gray-500 uppercase text-xs whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.sortable ? 'cursor-pointer select-none' : ''}`}
                      style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                      onClick={col.sortable && col.sortKey ? () => toggleSort(col.sortKey!) : undefined}>
                      {col.label}{col.sortable && col.sortKey && sortArrow(col.sortKey)}
                    </th>
                  ))}
                  <th className="w-16 px-3 py-3 sticky right-0 bg-gray-50 z-10" style={{ boxShadow: '-4px 0 6px -4px rgba(0,0,0,0.08)' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={visibleCols.length + 2} className="text-center py-10 text-gray-400">No accounts match your search.</td></tr>
                ) : filtered.map((acct) => {
                  const badge = SPECIES_BADGE[acct.industry] || SPECIES_BADGE.Other;
                  const isSelected = selectedIds.has(acct.id);
                  return (
                    <tr key={acct.id} className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors group ${isSelected ? 'bg-green-50/40' : ''}`}>
                      <td className="px-3 py-3">
                        <input type="checkbox" className="rounded border-gray-300" checked={isSelected}
                          onChange={(e) => { const n = new Set(selectedIds); if (e.target.checked) n.add(acct.id); else n.delete(acct.id); setSelectedIds(n); }} />
                      </td>
                      {visibleCols.map((col) => {
                        switch (col.id) {
                          case 'name': return <td key={col.id} className="px-4 py-3"><Link href={`/accounts/${acct.id}`} className="font-medium hover:underline" style={{ color: '#1a4731' }}>{acct.name}</Link></td>;
                          case 'industry': return (
                            <td key={col.id} className="px-4 py-3">
                              <select value={acct.industry || ''}
                                onChange={(e) => updateAccount(acct.id, { industry: e.target.value })}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-0.5 rounded font-medium border border-transparent hover:border-gray-300 focus:border-green-500 focus:outline-none cursor-pointer max-w-[150px]"
                                style={{ backgroundColor: badge?.bg, color: badge?.text }}>
                                <option value="">— Select —</option>
                                {INDUSTRY_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
                                {acct.industry && !INDUSTRY_LIST.includes(acct.industry) && <option value={acct.industry}>{acct.industry}</option>}
                              </select>
                            </td>
                          );
                          case 'companyType': return (
                            <td key={col.id} className="px-4 py-3">
                              <select value={acct.companyType || ''}
                                onChange={(e) => updateAccount(acct.id, { companyType: e.target.value })}
                                onClick={(e) => e.stopPropagation()}
                                className="text-sm text-gray-700 px-2 py-0.5 rounded border border-transparent hover:border-gray-300 focus:border-green-500 focus:outline-none bg-transparent cursor-pointer max-w-[160px]">
                                <option value="">—</option>
                                {COMPANY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                {acct.companyType && !COMPANY_TYPES.includes(acct.companyType) && <option value={acct.companyType}>{acct.companyType}</option>}
                              </select>
                            </td>
                          );
                          case 'owner': return (
                            <td key={col.id} className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {acct.ownerName && <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0" style={{ backgroundColor: '#1a4731' }}>{ownerInitials(acct.ownerName)}</div>}
                                <select value={acct.ownerId || ''}
                                  onChange={(e) => {
                                    const u = activeUsers.find((x) => x.id === e.target.value);
                                    updateAccount(acct.id, { ownerId: e.target.value, ownerName: u?.name || '' });
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-sm text-gray-800 px-2 py-0.5 rounded border border-transparent hover:border-gray-300 focus:border-green-500 focus:outline-none bg-transparent cursor-pointer max-w-[140px]">
                                  <option value="">—</option>
                                  {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                              </div>
                            </td>
                          );
                          case 'country': return (
                            <td key={col.id} className="px-4 py-3 text-sm">
                              <select value={acct.country || ''}
                                onChange={(e) => updateAccount(acct.id, { country: e.target.value })}
                                onClick={(e) => e.stopPropagation()}
                                className="text-sm px-2 py-0.5 rounded border border-transparent hover:border-gray-300 focus:border-green-500 focus:outline-none bg-transparent cursor-pointer">
                                <option value="">—</option>
                                {COUNTRY_LIST.map((c) => <option key={c} value={c}>{FLAGS[c] || '🌐'} {c}</option>)}
                                {acct.country && !COUNTRY_LIST.includes(acct.country) && <option value={acct.country}>{acct.country}</option>}
                              </select>
                            </td>
                          );
                          case 'phone': return <td key={col.id} className="px-4 py-3 text-sm text-gray-600">{acct.phone || '—'}</td>;
                          case 'employee': return <td key={col.id} className="px-4 py-3 text-right text-sm text-gray-600">{acct.employee ?? '—'}</td>;
                          case 'openDeals': { const d = dealsByAccount[acct.id]; return <td key={col.id} className="px-4 py-3 text-right text-sm text-gray-700">{d?.count ? <span className="font-medium" style={{ color: '#1a4731' }}>{d.count}</span> : <span className="text-gray-400">—</span>}</td>; }
                          case 'pipelineValue': { const d = dealsByAccount[acct.id]; return <td key={col.id} className="px-4 py-3 text-right text-sm font-medium text-gray-700">{d?.value ? `$${(d.value / 1000).toFixed(0)}K` : <span className="text-gray-400 font-normal">—</span>}</td>; }
                          case 'website': return <td key={col.id} className="px-4 py-3 text-sm">{acct.website ? <a href={acct.website.startsWith('http') ? acct.website : `https://${acct.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block max-w-[130px]">{stripUrl(acct.website)}</a> : <span className="text-gray-400">—</span>}</td>;
                          case 'address': return <td key={col.id} className="px-4 py-3 text-sm text-gray-500" title={acct.location || ''}>{acct.location ? (acct.location.length > 35 ? acct.location.slice(0, 35) + '...' : acct.location) : '—'}</td>;
                          default: return null;
                        }
                      })}
                      <td className={`px-3 py-3 sticky right-0 z-[1] ${isSelected ? 'bg-green-50' : 'bg-white'} group-hover:bg-gray-50`} style={{ boxShadow: '-4px 0 6px -4px rgba(0,0,0,0.08)' }}>
                        <div className="flex gap-1">
                          <button onClick={() => setEditAccountId(acct.id)} className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50" aria-label="Edit">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button onClick={() => setConfirmDeleteId(acct.id)} className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50" aria-label="Delete">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white border border-gray-200 px-6 py-3 rounded-xl shadow-lg flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">{selectedIds.size} account{selectedIds.size > 1 ? 's' : ''} selected</span>
          <button onClick={() => setShowBulkDelete(true)} className="px-4 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete Selected</button>
          <button onClick={() => setSelectedIds(new Set())} className="text-sm text-gray-400 hover:text-gray-600">Deselect All</button>
        </div>
      )}

      {/* Bulk delete confirmation */}
      {showBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete {selectedIds.size} accounts?</h2>
            <p className="text-sm text-gray-600 mb-1">This will permanently remove:</p>
            <ul className="text-sm text-gray-600 mb-3 list-disc pl-5">
              <li>{selectedIds.size} accounts</li>
              <li>All linked contacts ({contacts.filter((c) => selectedIds.has(c.accountId)).length} total)</li>
              <li>All linked opportunities & activities</li>
            </ul>
            <div className="text-xs text-gray-500 mb-4">
              {Array.from(selectedIds).slice(0, 5).map((id) => accounts.find((a) => a.id === id)?.name).filter(Boolean).join(', ')}
              {selectedIds.size > 5 && ` ...and ${selectedIds.size - 5} more`}
            </div>
            <p className="text-xs text-red-600 mb-4">This cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowBulkDelete(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={handleBulkDelete} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete {selectedIds.size} Accounts</button>
            </div>
          </div>
        </div>
      )}

      {showNewModal && <NewAccountModal onClose={() => setShowNewModal(false)} onSave={() => setToast('Account created successfully')} />}

      {editAccountId && (() => { const a = allAccounts.find((x) => x.id === editAccountId); return a ? <EditAccountModal account={a} onClose={() => setEditAccountId(null)} onSaved={() => setToast('Account updated successfully')} /> : null; })()}

      {confirmDeleteId && accountToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete Account</h2>
            <p className="text-sm text-gray-600 mb-1">Are you sure you want to delete <strong>{accountToDelete.name}</strong>?</p>
            <p className="text-xs text-red-600 mb-5">This will also delete all linked contacts, opportunities, activities, and tasks.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={handleDeleteConfirm} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && <ImportModal type="accounts" onClose={() => setShowImportModal(false)} onDone={(n) => { setShowImportModal(false); setToast(`${n} accounts imported`); }} />}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
