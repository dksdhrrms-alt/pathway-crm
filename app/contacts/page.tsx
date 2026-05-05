'use client';

import { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { generateId } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import SendEmailModal from '@/app/components/SendEmailModal';
import { useUsers } from '@/lib/UserContext';
import TopBar from '@/app/components/TopBar';
import NewContactModal from '@/app/components/NewContactModal';
import Toast from '@/app/components/Toast';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import ImportModal from '@/app/components/ImportModal';
import EditContactModal from '@/app/components/EditContactModal';
import ExportButton, { ExportColumn } from '@/app/components/ExportButton';
import ColumnFilter from '@/app/components/ColumnFilter';
import { SPECIES_LIST, CONTACT_TYPES } from '@/app/components/ContactForm';
import { getRoleLabel } from '@/lib/users';

const COUNTRY_FLAGS: Record<string, string> = { USA:'🇺🇸', Mexico:'🇲🇽', UK:'🇬🇧', Colombia:'🇨🇴', Peru:'🇵🇪', Panama:'🇵🇦', 'El Salvador':'🇸🇻', Korea:'🇰🇷' };

type SortKey = 'name' | 'company' | 'country' | 'owner' | 'position' | 'species' | 'birthday' | 'anniversary' | 'keyMan';
type SortDir = 'asc' | 'desc';
const SORTABLE_KEYS: SortKey[] = ['name','company','country','owner','position','species','birthday','anniversary','keyMan'];

export default function ContactsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ContactsPageInner />
    </Suspense>
  );
}

function ContactsPageInner() {
  const { data: session } = useSession();
  const isAdmin = ['administrative_manager','admin','ceo','sales_director','coo'].includes(session?.user?.role ?? '');
  const userId = session?.user?.id ?? '';

  const { contacts: allContacts, accounts: allAccounts, deleteContact, deleteContactsBulk, addActivity, updateContact, loading } = useCRM();
  const { users } = useUsers();

  function getOwnerName(ownerId: string): string {
    const user = users.find((u) => u.id === ownerId);
    return user ? user.name : '—';
  }

  const activeUsers = useMemo(() => users.filter((u) => u.status === 'active').sort((a, b) => a.name.localeCompare(b.name)), [users]);

  function speciesColors(s: string | undefined): { bg: string; color: string } {
    if (!s) return { bg: '#F1EFE8', color: '#5F5E5A' };
    if (['Broilers','Layers','Primary Breeders','Primary Breeder','Turkeys'].includes(s)) return { bg: '#E6F1FB', color: '#185FA5' };
    if (s === 'Ruminant') return { bg: '#E1F5EE', color: '#0F6E56' };
    if (s === 'Swine' || s === 'Swines') return { bg: '#FAEEDA', color: '#854F0B' };
    if (s === 'Aquaculture') return { bg: '#E1F5EE', color: '#0F6E56' };
    if (s.includes('Consulting')) return { bg: '#EEEDFE', color: '#534AB7' };
    return { bg: '#F1EFE8', color: '#5F5E5A' };
  }

  const contacts = useMemo(() => allContacts, [allContacts]);
  void isAdmin;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sortKey = (SORTABLE_KEYS.includes((searchParams.get('sort') || '') as SortKey) ? searchParams.get('sort') : 'name') as SortKey;
  const sortDir = (searchParams.get('dir') === 'desc' ? 'desc' : 'asc') as SortDir;

  const toggleSort = useCallback((key: SortKey) => {
    const params = new URLSearchParams(searchParams.toString());
    let nextDir: SortDir = 'asc';
    if (sortKey === key) nextDir = sortDir === 'asc' ? 'desc' : 'asc';
    params.set('sort', key);
    params.set('dir', nextDir);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, sortKey, sortDir, router, pathname]);

  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const [search, setSearch] = useState('');
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});

  // ── Pagination ─────────────────────────────────────────────────────────
  // Render in 50-row slices to keep DOM under control. With 375 contacts +
  // inline dropdowns the table was producing ~25k DOM nodes (Lighthouse
  // limit: 1,500). Slicing trims that to ~3k while preserving full sort /
  // filter behavior — pagination resets when filters change.
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
      species: uniq(allContacts.map((c) => c.species)),
      country: uniq(allContacts.map((c) => c.country)),
      owner: uniq(allContacts.map((c) => c.ownerName || getOwnerName(c.ownerId))),
      position: uniq(allContacts.map((c) => c.position)),
      company: uniq(allContacts.map((c) => allAccounts.find((a) => a.id === c.accountId)?.name || c.accountName || '')),
      keyMan: ['Yes', 'No'],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allContacts, allAccounts, users]);

  function getColValue(c: typeof allContacts[number], colId: string): string {
    switch (colId) {
      case 'species': return c.species || '';
      case 'country': return c.country || '';
      case 'owner': return c.ownerName || getOwnerName(c.ownerId) || '';
      case 'position': return c.position || '';
      case 'company': return allAccounts.find((a) => a.id === c.accountId)?.name || c.accountName || '';
      case 'keyMan': return c.isKeyMan ? 'Yes' : 'No';
      default: return '';
    }
  }

  const [showNewModal, setShowNewModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkEmail, setShowBulkEmail] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Column customization
  const ALL_COLUMNS = useMemo(() => [
    { id: 'name', label: 'Name', defaultVisible: true, minWidth: 160, sortable: true, sortKey: 'name' as SortKey },
    { id: 'species', label: 'Species', defaultVisible: true, minWidth: 160, sortable: true, sortKey: 'species' as SortKey },
    { id: 'company', label: 'Company', defaultVisible: true, minWidth: 160, sortable: true, sortKey: 'company' as SortKey },
    { id: 'country', label: 'Country', defaultVisible: true, minWidth: 110, sortable: true, sortKey: 'country' as SortKey },
    { id: 'owner', label: 'Owner', defaultVisible: true, minWidth: 120, sortable: true, sortKey: 'owner' as SortKey },
    { id: 'position', label: 'Contact Type', defaultVisible: true, minWidth: 150, sortable: true, sortKey: 'position' as SortKey },
    { id: 'keyMan', label: 'Key', defaultVisible: true, minWidth: 50, align: 'center' as const, sortable: true, sortKey: 'keyMan' as SortKey },
    { id: 'email', label: 'Email', defaultVisible: true, minWidth: 160, sortable: false },
    { id: 'tel', label: 'Tel', defaultVisible: true, minWidth: 130, sortable: false },
    { id: 'birthday', label: 'Birthday', defaultVisible: false, minWidth: 110, sortable: true, sortKey: 'birthday' as SortKey },
    { id: 'anniversary', label: 'Anniversary', defaultVisible: false, minWidth: 110, sortable: true, sortKey: 'anniversary' as SortKey },
    { id: 'linkedIn', label: 'LinkedIn', defaultVisible: false, minWidth: 130, sortable: false },
  ], []);
  const [columnOrder, setColumnOrder] = useState<string[]>(ALL_COLUMNS.map((c) => c.id));
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    new Set(ALL_COLUMNS.filter((c) => !c.defaultVisible).map((c) => c.id))
  );
  const [showColMenu, setShowColMenu] = useState(false);
  const [draggedCol, setDraggedCol] = useState<string | null>(null);

  const colOrderKey = `contacts_col_order_${userId || 'anon'}`;
  const colHiddenKey = `contacts_col_hidden_${userId || 'anon'}`;

  useEffect(() => {
    try {
      const order = localStorage.getItem(colOrderKey);
      const hidden = localStorage.getItem(colHiddenKey);
      if (order) {
        const saved: string[] = JSON.parse(order);
        const all = ALL_COLUMNS.map((c) => c.id);
        const merged = [...saved.filter((id) => all.includes(id)), ...all.filter((id) => !saved.includes(id))];
        setColumnOrder(merged);
      } else {
        setColumnOrder(ALL_COLUMNS.map((c) => c.id));
      }
      setHiddenColumns(hidden ? new Set(JSON.parse(hidden)) : new Set(ALL_COLUMNS.filter((c) => !c.defaultVisible).map((c) => c.id)));
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
    setHiddenColumns(new Set(ALL_COLUMNS.filter((c) => !c.defaultVisible).map((c) => c.id)));
    try { localStorage.removeItem(colOrderKey); localStorage.removeItem(colHiddenKey); } catch { /* */ }
  }
  const visibleCols = columnOrder.map((id) => ALL_COLUMNS.find((c) => c.id === id)!).filter((c) => c && !hiddenColumns.has(c.id));

  const filtered = useMemo(() => {
    let list = contacts.filter((c) => {
      const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
      const account = allAccounts.find((a) => a.id === c.accountId);
      const accountName = account?.name.toLowerCase() ?? '';
      const q = search.toLowerCase();
      return fullName.includes(q) || accountName.includes(q);
    });
    for (const [colId, sel] of Object.entries(colFilters)) {
      if (!sel || sel.size === 0) continue;
      list = list.filter((c) => sel.has(getColValue(c, colId)));
    }
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`); break;
        case 'company': {
          const an = allAccounts.find((x) => x.id === a.accountId)?.name || a.accountName || '';
          const bn = allAccounts.find((x) => x.id === b.accountId)?.name || b.accountName || '';
          cmp = an.localeCompare(bn);
          break;
        }
        case 'country': cmp = (a.country || '').localeCompare(b.country || ''); break;
        case 'owner': cmp = (a.ownerName || getOwnerName(a.ownerId) || '').localeCompare(b.ownerName || getOwnerName(b.ownerId) || ''); break;
        case 'position': cmp = (a.position || a.title || '').localeCompare(b.position || b.title || ''); break;
        case 'species': cmp = (a.species || '').localeCompare(b.species || ''); break;
        case 'birthday': cmp = (a.birthday || '').localeCompare(b.birthday || ''); break;
        case 'anniversary': cmp = (a.anniversary || '').localeCompare(b.anniversary || ''); break;
        case 'keyMan': cmp = (a.isKeyMan ? 1 : 0) - (b.isKeyMan ? 1 : 0); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, allAccounts, users, search, sortKey, sortDir, colFilters]);

  // Snap pagination back when the row set changes shape so we don't end up
  // showing an old "Showing 200 of …" window after a search narrows results.
  useEffect(() => {
    setDisplayLimit(PAGE_SIZE);
  }, [search, colFilters, sortKey, sortDir]);

  const visibleContacts = filtered.slice(0, displayLimit);
  const hasMore = filtered.length > visibleContacts.length;
  const remaining = filtered.length - visibleContacts.length;

  function handleContactSaved() {
    setToast('Contact created successfully');
  }

  function handleDeleteConfirm() {
    if (!confirmDeleteId) return;
    deleteContact(confirmDeleteId);
    setConfirmDeleteId(null);
    setToast('Contact deleted');
  }

  function bulkUpdate(field: 'species' | 'position' | 'country' | 'ownerId', value: string) {
    if (!value || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (field === 'ownerId') {
      const u = activeUsers.find((x) => x.id === value);
      ids.forEach((id) => updateContact(id, { ownerId: value, ownerName: u?.name || '' }));
    } else {
      ids.forEach((id) => updateContact(id, { [field]: value }));
    }
    const label = field === 'species' ? 'Species' : field === 'position' ? 'Contact Type' : field === 'country' ? 'Country' : 'Owner';
    setToast(`${ids.length} contact${ids.length > 1 ? 's' : ''} — ${label} updated`);
  }

  const COUNTRY_LIST = ['USA','Mexico','Colombia','Peru','Panama','El Salvador','Guatemala','Brazil','Ecuador','Bolivia','Chile','Dominican Republic','Jamaica','Korea','UK'];

  const contactToDelete = confirmDeleteId ? contacts.find((c) => c.id === confirmDeleteId) : null;

  const exportColumns: ExportColumn<typeof filtered[number]>[] = useMemo(() => [
    { id: 'firstName', label: 'First Name', getValue: (c) => c.firstName },
    { id: 'lastName', label: 'Last Name', getValue: (c) => c.lastName },
    { id: 'company', label: 'Company', getValue: (c) => allAccounts.find((a) => a.id === c.accountId)?.name || c.accountName || '' },
    { id: 'position', label: 'Position', getValue: (c) => c.position || c.title || '' },
    { id: 'species', label: 'Species', getValue: (c) => c.species || '' },
    { id: 'country', label: 'Country', getValue: (c) => c.country || '' },
    { id: 'owner', label: 'Owner', getValue: (c) => c.ownerName || getOwnerName(c.ownerId) || '' },
    { id: 'email', label: 'Email', getValue: (c) => c.email || '' },
    { id: 'tel', label: 'Telephone', getValue: (c) => c.phone || c.tel || '' },
    { id: 'keyMan', label: 'Key Man', getValue: (c) => c.isKeyMan ? 'Yes' : '' },
    { id: 'linkedIn', label: 'LinkedIn', getValue: (c) => c.linkedIn || '' },
    { id: 'birthday', label: 'Birthday', getValue: (c) => c.birthday || '' },
    { id: 'anniversary', label: 'Anniversary', getValue: (c) => c.anniversary || '' },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [allAccounts, users]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar searchValue={search} onSearchChange={setSearch} placeholder="Search contacts or accounts..." />

      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
              <p className="text-sm text-gray-500 mt-0.5">{filtered.length} of {contacts.length} contact{contacts.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <ExportButton filename={`contacts-${new Date().toISOString().split('T')[0]}`} title="Contacts" columns={exportColumns} rows={filtered} />
              <button onClick={() => setShowImportModal(true)} className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">+ Import</button>
              <button onClick={() => setShowNewModal(true)} className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity" style={{ backgroundColor: '#1a4731' }}>+ New Contact</button>
            </div>
          </div>

          {/* Column menu bar */}
          <div className="flex justify-end items-center gap-2 mb-3">
            {activeFilterCount > 0 && (
              <button onClick={clearAllFilters} className="text-xs text-green-700 bg-green-50 hover:bg-green-100 px-2.5 py-1 rounded-full border border-green-200 font-medium">
                Clear {activeFilterCount} column filter{activeFilterCount > 1 ? 's' : ''} ✕
              </button>
            )}
            <div className="relative">
              <button onClick={() => setShowColMenu(!showColMenu)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 bg-white">
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
                            <input type="checkbox" checked={!isHidden} onChange={() => toggleColumn(id)} className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
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

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto" style={{ minHeight: 500 }}>
            <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" className="rounded border-gray-300"
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onChange={(e) => { if (e.target.checked) setSelectedIds(new Set(filtered.map(c => c.id))); else setSelectedIds(new Set()); }}
                    />
                  </th>
                  {visibleCols.map((col) => {
                    const isFilterable = ['species','country','owner','position','company','keyMan'].includes(col.id);
                    return (
                      <th key={col.id}
                        className={`px-4 py-3 font-medium text-gray-500 uppercase text-xs whitespace-nowrap tracking-wide ${col.align === 'center' ? 'text-center' : 'text-left'}`}
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
                  <th className="w-16 px-3 py-3 sticky right-0 bg-gray-50 z-10" style={{ boxShadow: '-4px 0 6px -4px rgba(0,0,0,0.08)' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={visibleCols.length + 2} className="text-center text-gray-400" style={{ height: 400 }}>
                      No contacts match your search.
                    </td>
                  </tr>
                ) : (
                  visibleContacts.map((contact) => {
                    const account = allAccounts.find((a) => a.id === contact.accountId);
                    const isSelected = selectedIds.has(contact.id);
                    return (
                      <tr key={contact.id} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors group ${isSelected ? 'bg-green-50/40' : ''}`}>
                        <td className="px-4 py-3.5">
                          <input type="checkbox" className="rounded border-gray-300" checked={isSelected}
                            onChange={(e) => { const next = new Set(selectedIds); if (e.target.checked) next.add(contact.id); else next.delete(contact.id); setSelectedIds(next); }}
                          />
                        </td>
                        {visibleCols.map((col) => {
                          switch (col.id) {
                            case 'name': return (
                              <td key={col.id} className="px-4 py-3">
                                <Link href={`/contacts/${contact.id}`} className="font-semibold hover:underline" style={{ color: '#1a4731' }}>
                                  {contact.firstName} {contact.lastName}
                                </Link>
                              </td>
                            );
                            case 'species': { const sc = speciesColors(contact.species); return (
                              <td key={col.id} className="px-4 py-3">
                                <select value={contact.species || ''}
                                  onChange={(e) => updateContact(contact.id, { species: e.target.value })}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs px-2 py-0.5 rounded font-medium border border-transparent hover:border-gray-300 focus:border-green-500 focus:outline-none cursor-pointer max-w-[150px]"
                                  style={{ backgroundColor: sc.bg, color: sc.color }}>
                                  <option value="">— Select —</option>
                                  {SPECIES_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
                                  {contact.species && !SPECIES_LIST.includes(contact.species) && <option value={contact.species}>{contact.species}</option>}
                                </select>
                              </td>
                            ); }
                            case 'company': return (
                              <td key={col.id} className="px-4 py-3">
                                {account ? (
                                  <Link href={`/accounts/${account.id}`} className="text-sm hover:underline" style={{ color: '#2d6a4f' }}>{account.name}</Link>
                                ) : contact.accountName ? (
                                  <span className="text-gray-500 text-sm">{contact.accountName}</span>
                                ) : <span className="text-gray-400">—</span>}
                              </td>
                            );
                            case 'country': return (
                              <td key={col.id} className="px-4 py-3 text-sm">
                                {contact.country ? <span>{COUNTRY_FLAGS[contact.country] ?? '🌐'} {contact.country}</span> : <span className="text-gray-400">—</span>}
                              </td>
                            );
                            case 'owner': return (
                              <td key={col.id} className="px-4 py-3 text-sm">
                                <select value={contact.ownerId || ''}
                                  onChange={(e) => {
                                    const u = activeUsers.find((x) => x.id === e.target.value);
                                    updateContact(contact.id, { ownerId: e.target.value, ownerName: u?.name || '' });
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-sm text-gray-700 px-2 py-0.5 rounded border border-transparent hover:border-gray-300 focus:border-green-500 focus:outline-none bg-transparent cursor-pointer max-w-[140px]">
                                  <option value="">—</option>
                                  {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({getRoleLabel(u.role)})</option>)}
                                </select>
                              </td>
                            );
                            case 'position': return (
                              <td key={col.id} className="px-4 py-3 text-sm">
                                <select value={contact.position || ''}
                                  onChange={(e) => updateContact(contact.id, { position: e.target.value })}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-sm text-gray-700 px-2 py-0.5 rounded border border-transparent hover:border-gray-300 focus:border-green-500 focus:outline-none bg-transparent cursor-pointer max-w-[160px]">
                                  <option value="">—</option>
                                  {CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                  {contact.position && !CONTACT_TYPES.includes(contact.position) && <option value={contact.position}>{contact.position}</option>}
                                </select>
                              </td>
                            );
                            case 'keyMan': return (
                              <td key={col.id} className="px-3 py-3 text-center" title={contact.isKeyMan ? 'Key contact' : 'Not a key contact'}>
                                <span className={contact.isKeyMan ? 'text-amber-500' : 'text-gray-300'}>{contact.isKeyMan ? '★' : '☆'}</span>
                              </td>
                            );
                            case 'email': return (
                              <td key={col.id} className="px-4 py-3 text-sm">
                                {contact.email ? (
                                  <a href={`mailto:${contact.email}`} className="text-gray-500 hover:text-blue-600 truncate block max-w-[180px]" title={contact.email}>{contact.email}</a>
                                ) : <span className="text-gray-400">—</span>}
                              </td>
                            );
                            case 'tel': return <td key={col.id} className="px-4 py-3 text-sm text-gray-500">{contact.phone || contact.tel || '—'}</td>;
                            case 'birthday': return <td key={col.id} className="px-4 py-3 text-sm text-gray-500">{contact.birthday || <span className="text-gray-400">—</span>}</td>;
                            case 'anniversary': return <td key={col.id} className="px-4 py-3 text-sm text-gray-500">{contact.anniversary || <span className="text-gray-400">—</span>}</td>;
                            case 'linkedIn': return (
                              <td key={col.id} className="px-4 py-3 text-sm">
                                {contact.linkedIn ? <a href={contact.linkedIn} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">LinkedIn</a> : <span className="text-gray-400">—</span>}
                              </td>
                            );
                            default: return null;
                          }
                        })}
                        <td className={`px-3 py-3.5 sticky right-0 z-[1] ${isSelected ? 'bg-green-50' : 'bg-white'} group-hover:bg-gray-50`} style={{ boxShadow: '-4px 0 6px -4px rgba(0,0,0,0.08)' }}>
                          <div className="flex gap-1">
                            <button onClick={() => setEditContactId(contact.id)} className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50" aria-label="Edit">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            <button onClick={() => setConfirmDeleteId(contact.id)} className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50" aria-label="Delete contact">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
                {hasMore && (
                  <tr>
                    <td colSpan={visibleCols.length + 2} className="px-4 py-4 text-center bg-gray-50/40">
                      <div className="flex items-center justify-center gap-3 text-xs text-gray-500">
                        <span>
                          Showing <span className="font-medium text-gray-700">{visibleContacts.length}</span> of <span className="font-medium text-gray-700">{filtered.length}</span>
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
                            onClick={() => setDisplayLimit(filtered.length)}
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

      {showNewModal && <NewContactModal onClose={() => setShowNewModal(false)} onSave={handleContactSaved} />}

      {confirmDeleteId && contactToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete Contact</h2>
            <p className="text-sm text-gray-600 mb-5">
              Are you sure you want to delete <strong>{contactToDelete.firstName} {contactToDelete.lastName}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
              <button onClick={handleDeleteConfirm} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white border border-gray-200 px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 flex-wrap max-w-[95vw]">
          <span className="text-sm font-medium text-gray-700 whitespace-nowrap">{selectedIds.size} selected</span>
          <span className="text-xs text-gray-400 border-l border-gray-200 pl-3">Bulk update:</span>
          <select onChange={(e) => { bulkUpdate('species', e.target.value); e.target.value = ''; }}
            className="text-xs px-2 py-1 border border-gray-300 rounded-lg cursor-pointer hover:border-green-400" defaultValue="">
            <option value="" disabled>Species…</option>
            {SPECIES_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select onChange={(e) => { bulkUpdate('position', e.target.value); e.target.value = ''; }}
            className="text-xs px-2 py-1 border border-gray-300 rounded-lg cursor-pointer hover:border-green-400" defaultValue="">
            <option value="" disabled>Contact Type…</option>
            {CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select onChange={(e) => { bulkUpdate('ownerId', e.target.value); e.target.value = ''; }}
            className="text-xs px-2 py-1 border border-gray-300 rounded-lg cursor-pointer hover:border-green-400" defaultValue="">
            <option value="" disabled>Owner…</option>
            {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select onChange={(e) => { bulkUpdate('country', e.target.value); e.target.value = ''; }}
            className="text-xs px-2 py-1 border border-gray-300 rounded-lg cursor-pointer hover:border-green-400" defaultValue="">
            <option value="" disabled>Country…</option>
            {COUNTRY_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => setShowBulkEmail(true)} className="px-3 py-1 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 border-l border-gray-200 ml-1">Email</button>
          <button onClick={() => setShowBulkDelete(true)} className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete</button>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
        </div>
      )}

      {showBulkEmail && (
        <SendEmailModal
          recipients={allContacts.filter((c) => selectedIds.has(c.id) && c.email).map((c) => ({ email: c.email, name: `${c.firstName} ${c.lastName}`, contactId: c.id }))}
          singleRecipient={false}
          onClose={() => setShowBulkEmail(false)}
          onSent={(subject, body, recipients) => {
            recipients.forEach((r) => {
              const contact = allContacts.find(c => c.id === r.contactId);
              addActivity({
                id: generateId(),
                type: 'Email' as const,
                subject,
                description: `Email sent: ${body.slice(0, 100)}`,
                date: new Date().toISOString().split('T')[0],
                ownerId: session?.user?.id ?? '',
                accountId: contact?.accountId ?? '',
                contactId: r.contactId,
              });
            });
            setToast(`Email sent to ${recipients.length} contact(s)`);
            setSelectedIds(new Set());
          }}
        />
      )}

      {showImportModal && <ImportModal type="contacts" onClose={() => setShowImportModal(false)} onDone={(n) => { setShowImportModal(false); setToast(`${n} contacts imported`); }} />}

      {showBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete {selectedIds.size} contacts?</h2>
            <p className="text-sm text-gray-600 mb-3">This will permanently remove {selectedIds.size} contacts and their linked activities.</p>
            <p className="text-xs text-red-600 mb-4">This cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowBulkDelete(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={() => { deleteContactsBulk(Array.from(selectedIds)); setToast(`${selectedIds.size} contacts deleted`); setSelectedIds(new Set()); setShowBulkDelete(false); }} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete {selectedIds.size} Contacts</button>
            </div>
          </div>
        </div>
      )}

      {editContactId && (() => { const c = allContacts.find((x) => x.id === editContactId); return c ? <EditContactModal contact={c} onClose={() => setEditContactId(null)} onSaved={() => setToast('Contact updated successfully')} /> : null; })()}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
