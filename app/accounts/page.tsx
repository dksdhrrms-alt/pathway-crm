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
import ColumnFilter from '@/app/components/ColumnFilter';
import ConfirmDialog from '@/app/components/ConfirmDialog';

const FLAGS: Record<string, string> = {
  USA: '🇺🇸', Mexico: '🇲🇽', Colombia: '🇨🇴', Peru: '🇵🇪', Panama: '🇵🇦',
  'El Salvador': '🇸🇻', UK: '🇬🇧', Korea: '🇰🇷', Guatemala: '🇬🇹',
  Brazil: '🇧🇷', Ecuador: '🇪🇨', Bolivia: '🇧🇴',
};

const COUNTRY_LIST = ['USA','Mexico','Colombia','Peru','Panama','El Salvador','Guatemala','Brazil','Ecuador','Bolivia','Chile','Dominican Republic','Jamaica','Korea','UK'];

const INDUSTRY_LIST = ['Dairy/Beef','Dairy','Beef','Poultry','Swine','Feed Mill','Aquaculture','Multi-Species','Veterinary Hospital','Veterinary Clinic','Distributor','Research','University','Other'];

const COMPANY_TYPES = [
  'Poultry Integrator',
  'Swine Integratory',
  'Dairy Farm - single site',
  'Dairy Farm - multisite',
  'Feedlot',
  'Beef operation other (calf ranch)',
  'Feed Mill - all species',
  'Feed Mill - dairy',
  'Feed Mill - poultry',
  'Feed Mill Swine',
  'Distributor',
  'Freight Carrier',
];

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
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});

  // ── Pagination ─────────────────────────────────────────────────────────
  // The table previously rendered all 411 accounts at once, which produced
  // ~37k DOM nodes (Lighthouse warns above 1,500). We render in slices and
  // expose a "Show more" footer instead. PAGE_SIZE is roomy enough that
  // keyboard-PageDown / scroll-jumping users rarely have to click.
  const PAGE_SIZE = 50;
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);

  function setColFilter(colId: string, sel: Set<string>) {
    setColFilters((prev) => {
      const next = { ...prev };
      if (sel.size === 0) delete next[colId]; else next[colId] = sel;
      return next;
    });
  }
  const activeFilterCount = Object.keys(colFilters).length;
  function clearAllFilters() { setColFilters({}); }

  const filterValues = useMemo(() => {
    const uniq = (vals: (string | undefined | null)[]) => [...new Set(vals.map((v) => v || ''))].sort((a, b) => a.localeCompare(b));
    return {
      industry: uniq(accounts.map((a) => a.industry)),
      companyType: uniq(accounts.map((a) => a.companyType)),
      country: uniq(accounts.map((a) => a.country)),
      owner: uniq(accounts.map((a) => a.ownerName)),
    };
  }, [accounts]);

  function getColValue(a: typeof accounts[number], colId: string): string {
    switch (colId) {
      case 'industry': return a.industry || '';
      case 'companyType': return a.companyType || '';
      case 'country': return a.country || '';
      case 'owner': return a.ownerName || '';
      default: return '';
    }
  }

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
    for (const [colId, sel] of Object.entries(colFilters)) {
      if (!sel || sel.size === 0) continue;
      list = list.filter((a) => sel.has(getColValue(a, colId)));
    }
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
  }, [accounts, search, sortKey, sortDir, ownerFilter, dealsByAccount, colFilters]);

  // Integration accordion: top-level only by default; expand parents to show children inline.
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  function toggleExpand(id: string) {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const contactCountByAccount = useMemo(() => {
    const map: Record<string, number> = {};
    contacts.forEach((c) => {
      if (c.accountId) map[c.accountId] = (map[c.accountId] || 0) + 1;
    });
    return map;
  }, [contacts]);

  const childrenByParent = useMemo(() => {
    const map: Record<string, typeof allAccounts> = {};
    allAccounts.forEach((a) => {
      if (a.parentAccountId) {
        if (!map[a.parentAccountId]) map[a.parentAccountId] = [];
        map[a.parentAccountId].push(a);
      }
    });
    return map;
  }, [allAccounts]);

  // Accordion only when no search/filter is active — otherwise users would lose matched children.
  const hasActiveFilters = search.trim().length > 0 || ownerFilter !== 'all' || activeFilterCount > 0;

  const renderedRows = useMemo(() => {
    type Row = { account: typeof filtered[number]; depth: number };
    if (hasActiveFilters) return filtered.map((a) => ({ account: a, depth: 0 } as Row));
    const topLevel = filtered.filter((a) => !a.parentAccountId);
    const rows: Row[] = [];
    for (const a of topLevel) {
      rows.push({ account: a, depth: 0 });
      if (expandedParents.has(a.id)) {
        const children = (childrenByParent[a.id] || []).slice().sort((x, y) => x.name.localeCompare(y.name));
        children.forEach((c) => rows.push({ account: c, depth: 1 }));
      }
    }
    return rows;
  }, [filtered, expandedParents, childrenByParent, hasActiveFilters]);

  // Snap the display window back to PAGE_SIZE whenever the underlying row set
  // changes shape (search, filter, sort, owner). Without this, "Showing 200 of
  // 411" sticks even after a filter narrows the result to 5 rows.
  useEffect(() => {
    setDisplayLimit(PAGE_SIZE);
  }, [search, ownerFilter, colFilters, sortKey, sortDir, hasActiveFilters]);

  const visibleRows = renderedRows.slice(0, displayLimit);
  const hasMore = renderedRows.length > visibleRows.length;
  const remaining = renderedRows.length - visibleRows.length;

  function expandAll() {
    const ids = new Set<string>();
    Object.keys(childrenByParent).forEach((id) => ids.add(id));
    setExpandedParents(ids);
  }
  function collapseAll() { setExpandedParents(new Set()); }
  const totalParentsWithChildren = Object.keys(childrenByParent).length;

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

  function bulkUpdate(field: 'industry' | 'companyType' | 'country' | 'ownerId', value: string) {
    if (!value || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (field === 'ownerId') {
      const u = activeUsers.find((x) => x.id === value);
      ids.forEach((id) => updateAccount(id, { ownerId: value, ownerName: u?.name || '' }));
    } else {
      ids.forEach((id) => updateAccount(id, { [field]: value }));
    }
    const fieldLabel = field === 'industry' ? 'Species' : field === 'companyType' ? 'Company Type' : field === 'country' ? 'Country' : 'Owner';
    setToast(`${ids.length} account${ids.length > 1 ? 's' : ''} — ${fieldLabel} updated`);
  }

  const accountToDelete = confirmDeleteId ? accounts.find((a) => a.id === confirmDeleteId) : null;
  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar searchValue={search} onSearchChange={setSearch} placeholder="Search accounts..." />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Accounts</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {filtered.length} of {accounts.length} account{accounts.length !== 1 ? 's' : ''}{isAdmin ? ' total' : ''}
                {!hasActiveFilters && totalParentsWithChildren > 0 && (
                  <span className="text-gray-400"> · {totalParentsWithChildren} integration{totalParentsWithChildren > 1 ? 's' : ''}</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <ExportButton filename={`accounts-${new Date().toISOString().split('T')[0]}`} title="Accounts" columns={exportColumns} rows={filtered} />
              <button onClick={() => setShowImportModal(true)} className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">+ Import</button>
              <button onClick={() => setShowNewModal(true)} className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>+ New Account</button>
            </div>
          </div>

          {/* Filter bar */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Filter by Owner:</span>
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-800 dark:text-gray-100 min-w-[200px]">
              <option value="all">All Owners ({accounts.length})</option>
              {ownerOptions.map((o) => {
                const count = accounts.filter((a) => a.ownerId === o.id).length;
                return <option key={o.id} value={o.id}>{o.name} ({count})</option>;
              })}
            </select>
            {activeFilterCount > 0 && (
              <button onClick={clearAllFilters} className="text-xs text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/40 hover:bg-green-100 dark:hover:bg-green-900/50 px-2.5 py-1 rounded-full border border-green-200 dark:border-green-800 font-medium">
                Clear {activeFilterCount} column filter{activeFilterCount > 1 ? 's' : ''} ✕
              </button>
            )}
            {ownerFilter !== 'all' && (
              <button onClick={() => setOwnerFilter('all')} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 underline">
                Clear filter
              </button>
            )}
            {!hasActiveFilters && totalParentsWithChildren > 0 && (
              <div className="ml-auto flex items-center gap-1">
                <button onClick={expandAll} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-slate-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:border-blue-300 dark:hover:border-blue-700 text-gray-700 dark:text-gray-200">
                  ▼ Expand all
                </button>
                <button onClick={collapseAll} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-200">
                  ▶ Collapse
                </button>
              </div>
            )}
            <div className={`${hasActiveFilters || totalParentsWithChildren === 0 ? 'ml-auto' : ''} relative`}>
              <button onClick={() => setShowColMenu(!showColMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 dark:text-gray-100">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
                Columns ({visibleCols.length}/{ALL_COLUMNS.length})
              </button>
              {showColMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-20 p-2">
                    <div className="flex items-center justify-between px-2 py-1.5 mb-1 border-b border-gray-100 dark:border-slate-700">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Columns</span>
                      <button onClick={resetColumns} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Reset</button>
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 px-2 mb-1">Drag to reorder · Click to toggle</p>
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
                            className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-slate-700 cursor-move ${draggedCol === id ? 'opacity-50' : ''}`}>
                            <span className="text-gray-300 dark:text-slate-500 text-xs">⋮⋮</span>
                            <input type="checkbox" checked={!isHidden} onChange={() => toggleColumn(id)}
                              className="rounded border-gray-300 dark:border-slate-600 text-green-600 focus:ring-green-500" />
                            <span className={`text-sm flex-1 ${isHidden ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200'}`}>{col.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-x-auto" style={{ minHeight: 500 }}>
            <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800">
                  <th className="w-10 px-3 py-3">
                    <input type="checkbox" className="rounded border-gray-300 dark:border-slate-600"
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onChange={(e) => { if (e.target.checked) setSelectedIds(new Set(filtered.map((a) => a.id))); else setSelectedIds(new Set()); }} />
                  </th>
                  {visibleCols.map((col) => {
                    const isFilterable = ['industry','companyType','country','owner'].includes(col.id);
                    return (
                      <th key={col.id}
                        className={`px-4 py-3 font-medium text-gray-500 dark:text-gray-400 uppercase text-xs whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                        style={col.minWidth ? { minWidth: col.minWidth } : undefined}>
                        <span className={col.sortable ? 'cursor-pointer select-none hover:text-gray-700' : ''}
                          onClick={col.sortable && col.sortKey ? () => toggleSort(col.sortKey!) : undefined}>
                          {col.label}{col.sortable && col.sortKey && sortArrow(col.sortKey)}
                        </span>
                        {isFilterable && filterValues[col.id as keyof typeof filterValues] && (
                          <ColumnFilter
                            label={col.label}
                            values={filterValues[col.id as keyof typeof filterValues]}
                            selected={colFilters[col.id] || new Set()}
                            onChange={(s) => setColFilter(col.id, s)}
                          />
                        )}
                      </th>
                    );
                  })}
                  <th className="w-16 px-3 py-3 sticky right-0 bg-gray-50 dark:bg-slate-800 z-10" style={{ boxShadow: '-4px 0 6px -4px rgba(0,0,0,0.08)' }}></th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.length === 0 ? (
                  <tr><td colSpan={visibleCols.length + 2} className="text-center text-gray-400 dark:text-gray-500" style={{ height: 400 }}>No accounts match your search.</td></tr>
                ) : visibleRows.map(({ account: acct, depth }) => {
                  const badge = SPECIES_BADGE[acct.industry] || SPECIES_BADGE.Other;
                  const isSelected = selectedIds.has(acct.id);
                  return (
                    <tr key={acct.id} className={`border-b border-gray-50 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors group ${isSelected ? 'bg-green-50/40 dark:bg-green-950/20' : ''} ${depth > 0 ? 'bg-blue-50/20 dark:bg-blue-950/10' : ''}`}>
                      <td className="px-3 py-3">
                        <input type="checkbox" className="rounded border-gray-300 dark:border-slate-600" checked={isSelected}
                          onChange={(e) => { const n = new Set(selectedIds); if (e.target.checked) n.add(acct.id); else n.delete(acct.id); setSelectedIds(n); }} />
                      </td>
                      {visibleCols.map((col) => {
                        switch (col.id) {
                          case 'name': {
                            const parent = acct.parentAccountId ? allAccounts.find((a) => a.id === acct.parentAccountId) : null;
                            const childCount = (childrenByParent[acct.id] || []).length;
                            const isExpanded = expandedParents.has(acct.id);
                            return (
                              <td key={col.id} className="px-4 py-3">
                                <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 24 }}>
                                  {/* Chevron for parents (only in accordion mode) */}
                                  {!hasActiveFilters && childCount > 0 && depth === 0 ? (
                                    <button onClick={() => toggleExpand(acct.id)}
                                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-blue-100 text-blue-700 text-xs"
                                      title={isExpanded ? 'Collapse' : 'Expand'}>
                                      {isExpanded ? '▼' : '▶'}
                                    </button>
                                  ) : depth === 0 ? (
                                    <span className="w-5 h-5 inline-block" />
                                  ) : (
                                    <span className="text-blue-300 text-xs" title="Complex">↳</span>
                                  )}
                                  <Link href={`/accounts/${acct.id}`} className="font-medium hover:underline" style={{ color: depth > 0 ? '#2d6a4f' : '#1a4731' }}>{acct.name}</Link>
                                  {childCount > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium" title={`${childCount} child account${childCount > 1 ? 's' : ''}`}>
                                      +{childCount}
                                    </span>
                                  )}
                                  {(contactCountByAccount[acct.id] || 0) > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium" title={`${contactCountByAccount[acct.id]} contact${contactCountByAccount[acct.id] > 1 ? 's' : ''}`}>
                                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                      {contactCountByAccount[acct.id]}
                                    </span>
                                  )}
                                </div>
                                {/* Parent breadcrumb only when accordion off (search active) and account is a child */}
                                {hasActiveFilters && parent && <p className="text-[11px] text-gray-400 mt-0.5 ml-6">↳ <Link href={`/accounts/${parent.id}`} className="hover:underline">{parent.name}</Link></p>}
                              </td>
                            );
                          }
                          case 'industry': return (
                            <td key={col.id} className="px-4 py-3">
                              <select value={acct.industry || ''}
                                onChange={(e) => updateAccount(acct.id, { industry: e.target.value })}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-0.5 rounded font-medium border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-green-500 focus:outline-none cursor-pointer max-w-[150px] dark:bg-slate-700 dark:text-gray-100 dark:focus:border-green-400"
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
                                className="text-sm text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-green-500 focus:outline-none bg-transparent dark:bg-slate-700 cursor-pointer max-w-[160px]">
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
                                  className="text-sm text-gray-800 dark:text-gray-200 px-2 py-0.5 rounded border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-green-500 focus:outline-none bg-transparent dark:bg-slate-700 cursor-pointer max-w-[140px]">
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
                          case 'phone': return <td key={col.id} className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{acct.phone || '—'}</td>;
                          case 'employee': return <td key={col.id} className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-300">{acct.employee ?? '—'}</td>;
                          case 'openDeals': { const d = dealsByAccount[acct.id]; return <td key={col.id} className="px-4 py-3 text-right text-sm text-gray-700 dark:text-gray-200">{d?.count ? <span className="font-medium" style={{ color: '#1a4731' }}>{d.count}</span> : <span className="text-gray-400 dark:text-gray-500">—</span>}</td>; }
                          case 'pipelineValue': { const d = dealsByAccount[acct.id]; return <td key={col.id} className="px-4 py-3 text-right text-sm font-medium text-gray-700 dark:text-gray-200">{d?.value ? `$${(d.value / 1000).toFixed(0)}K` : <span className="text-gray-400 dark:text-gray-500 font-normal">—</span>}</td>; }
                          case 'website': return <td key={col.id} className="px-4 py-3 text-sm">{acct.website ? <a href={acct.website.startsWith('http') ? acct.website : `https://${acct.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline truncate block max-w-[130px]">{stripUrl(acct.website)}</a> : <span className="text-gray-400 dark:text-gray-500">—</span>}</td>;
                          case 'address': return <td key={col.id} className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400" title={acct.location || ''}>{acct.location ? (acct.location.length > 35 ? acct.location.slice(0, 35) + '...' : acct.location) : '—'}</td>;
                          default: return null;
                        }
                      })}
                      <td className={`px-3 py-3 sticky right-0 z-[1] ${isSelected ? 'bg-green-50 dark:bg-green-950/20' : 'bg-white dark:bg-slate-900'} group-hover:bg-gray-50 dark:group-hover:bg-slate-800`} style={{ boxShadow: '-4px 0 6px -4px rgba(0,0,0,0.08)' }}>
                        <div className="flex gap-1">
                          <button onClick={() => setEditAccountId(acct.id)} className="p-2 rounded text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40" aria-label="Edit">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button onClick={() => setConfirmDeleteId(acct.id)} className="p-2 rounded text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40" aria-label="Delete">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {hasMore && (
                  <tr>
                    <td colSpan={visibleCols.length + 2} className="px-4 py-4 text-center bg-gray-50/40">
                      <div className="flex items-center justify-center gap-3 text-xs text-gray-500">
                        <span>
                          Showing <span className="font-medium text-gray-700">{visibleRows.length}</span> of <span className="font-medium text-gray-700">{renderedRows.length}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setDisplayLimit((n) => n + PAGE_SIZE)}
                          className="px-3 py-1.5 text-xs font-medium text-white rounded-md hover:opacity-90"
                          style={{ backgroundColor: '#1a4731' }}
                        >
                          Show {Math.min(PAGE_SIZE, remaining)} more
                        </button>
                        {remaining > PAGE_SIZE && (
                          <button
                            type="button"
                            onClick={() => setDisplayLimit(renderedRows.length)}
                            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                          >
                            Show all ({remaining})
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 flex-wrap max-w-[95vw]">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">{selectedIds.size} selected</span>
          <span className="text-xs text-gray-400 dark:text-gray-500 border-l border-gray-200 dark:border-slate-700 pl-3">Bulk update:</span>
          <select onChange={(e) => { bulkUpdate('industry', e.target.value); e.target.value = ''; }}
            className="text-xs px-2 py-1 border border-gray-300 dark:border-slate-600 rounded-lg cursor-pointer hover:border-green-400 dark:bg-slate-800 dark:text-gray-100" defaultValue="">
            <option value="" disabled>Species…</option>
            {INDUSTRY_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select onChange={(e) => { bulkUpdate('companyType', e.target.value); e.target.value = ''; }}
            className="text-xs px-2 py-1 border border-gray-300 dark:border-slate-600 rounded-lg cursor-pointer hover:border-green-400 dark:bg-slate-800 dark:text-gray-100" defaultValue="">
            <option value="" disabled>Company Type…</option>
            {COMPANY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select onChange={(e) => { bulkUpdate('ownerId', e.target.value); e.target.value = ''; }}
            className="text-xs px-2 py-1 border border-gray-300 dark:border-slate-600 rounded-lg cursor-pointer hover:border-green-400 dark:bg-slate-800 dark:text-gray-100" defaultValue="">
            <option value="" disabled>Sales Owner…</option>
            {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select onChange={(e) => { bulkUpdate('country', e.target.value); e.target.value = ''; }}
            className="text-xs px-2 py-1 border border-gray-300 dark:border-slate-600 rounded-lg cursor-pointer hover:border-green-400 dark:bg-slate-800 dark:text-gray-100" defaultValue="">
            <option value="" disabled>Country…</option>
            {COUNTRY_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => setShowBulkDelete(true)} className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 border-l border-gray-200 dark:border-slate-700 ml-1">Delete</button>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400">Clear</button>
        </div>
      )}

      {/* Bulk delete confirmation */}
      <ConfirmDialog
        open={showBulkDelete}
        title={`Delete ${selectedIds.size} accounts?`}
        description={
          <>
            This permanently removes {selectedIds.size} accounts and{' '}
            {contacts.filter((c) => selectedIds.has(c.accountId)).length} linked contacts,
            plus all opportunities and activities under them. This cannot be undone.
            <br />
            <span className="block mt-2 text-xs text-gray-400 dark:text-gray-500">
              {Array.from(selectedIds).slice(0, 5).map((id) => accounts.find((a) => a.id === id)?.name).filter(Boolean).join(', ')}
              {selectedIds.size > 5 && ` …and ${selectedIds.size - 5} more`}
            </span>
          </>
        }
        tone="danger"
        confirmLabel={`Delete ${selectedIds.size} accounts`}
        onCancel={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
      />

      {showNewModal && <NewAccountModal onClose={() => setShowNewModal(false)} onSave={() => setToast('Account created successfully')} />}

      {editAccountId && (() => { const a = allAccounts.find((x) => x.id === editAccountId); return a ? <EditAccountModal account={a} onClose={() => setEditAccountId(null)} onSaved={() => setToast('Account updated successfully')} /> : null; })()}

      <ConfirmDialog
        open={!!(confirmDeleteId && accountToDelete)}
        title="Delete this account?"
        description={
          accountToDelete ? (
            <>
              <strong>{accountToDelete.name}</strong> will be removed, along with all linked contacts, opportunities, activities, and tasks. This cannot be undone.
            </>
          ) : null
        }
        tone="danger"
        confirmLabel="Delete"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={handleDeleteConfirm}
      />

      {showImportModal && <ImportModal type="accounts" onClose={() => setShowImportModal(false)} onDone={(n) => { setShowImportModal(false); setToast(`${n} accounts imported`); }} />}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
