'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
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

const COUNTRY_FLAGS: Record<string, string> = { USA:'🇺🇸', Mexico:'🇲🇽', UK:'🇬🇧', Colombia:'🇨🇴', Peru:'🇵🇪', Panama:'🇵🇦', 'El Salvador':'🇸🇻', Korea:'🇰🇷' };

export default function ContactsPage() {
  const { data: session } = useSession();
  const isAdmin = ['administrative_manager','admin','ceo','sales_director','coo'].includes(session?.user?.role ?? '');
  const userId = session?.user?.id ?? '';

  const { contacts: allContacts, accounts: allAccounts, deleteContact, deleteContactsBulk, addActivity, loading } = useCRM();
  const { users } = useUsers();

  function getOwnerName(ownerId: string): string {
    const user = users.find((u) => u.id === ownerId);
    return user ? user.name : '—';
  }

  const contacts = useMemo(() => allContacts, [allContacts]);
  void isAdmin; void userId;

  const [search, setSearch] = useState('');
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
    { id: 'name', label: 'Name', defaultVisible: true, minWidth: 160 },
    { id: 'species', label: 'Species', defaultVisible: true, minWidth: 160 },
    { id: 'company', label: 'Company', defaultVisible: true, minWidth: 160 },
    { id: 'country', label: 'Country', defaultVisible: true, minWidth: 110 },
    { id: 'owner', label: 'Owner', defaultVisible: true, minWidth: 120 },
    { id: 'position', label: 'Position', defaultVisible: true, minWidth: 140 },
    { id: 'keyMan', label: 'Key', defaultVisible: true, minWidth: 50, align: 'center' as const },
    { id: 'email', label: 'Email', defaultVisible: true, minWidth: 160 },
    { id: 'tel', label: 'Tel', defaultVisible: true, minWidth: 130 },
    { id: 'birthday', label: 'Birthday', defaultVisible: false, minWidth: 110 },
    { id: 'anniversary', label: 'Anniversary', defaultVisible: false, minWidth: 110 },
    { id: 'linkedIn', label: 'LinkedIn', defaultVisible: false, minWidth: 130 },
  ], []);
  const [columnOrder, setColumnOrder] = useState<string[]>(ALL_COLUMNS.map((c) => c.id));
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    new Set(ALL_COLUMNS.filter((c) => !c.defaultVisible).map((c) => c.id))
  );
  const [showColMenu, setShowColMenu] = useState(false);
  const [draggedCol, setDraggedCol] = useState<string | null>(null);

  useEffect(() => {
    try {
      const order = localStorage.getItem('contacts_col_order');
      const hidden = localStorage.getItem('contacts_col_hidden');
      if (order) {
        const saved: string[] = JSON.parse(order);
        const all = ALL_COLUMNS.map((c) => c.id);
        const merged = [...saved.filter((id) => all.includes(id)), ...all.filter((id) => !saved.includes(id))];
        setColumnOrder(merged);
      }
      if (hidden) setHiddenColumns(new Set(JSON.parse(hidden)));
    } catch { /* */ }
  }, [ALL_COLUMNS]);

  function saveCols(order: string[], hidden: Set<string>) {
    try {
      localStorage.setItem('contacts_col_order', JSON.stringify(order));
      localStorage.setItem('contacts_col_hidden', JSON.stringify([...hidden]));
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
    try { localStorage.removeItem('contacts_col_order'); localStorage.removeItem('contacts_col_hidden'); } catch { /* */ }
  }
  const visibleCols = columnOrder.map((id) => ALL_COLUMNS.find((c) => c.id === id)!).filter((c) => c && !hiddenColumns.has(c.id));

  const filtered = contacts.filter((c) => {
    const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
    const account = allAccounts.find((a) => a.id === c.accountId);
    const accountName = account?.name.toLowerCase() ?? '';
    const q = search.toLowerCase();
    return fullName.includes(q) || accountName.includes(q);
  });

  function handleContactSaved() {
    setToast('Contact created successfully');
  }

  function handleDeleteConfirm() {
    if (!confirmDeleteId) return;
    deleteContact(confirmDeleteId);
    setConfirmDeleteId(null);
    setToast('Contact deleted');
  }

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
          <div className="flex justify-end mb-3">
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

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" className="rounded border-gray-300"
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onChange={(e) => { if (e.target.checked) setSelectedIds(new Set(filtered.map(c => c.id))); else setSelectedIds(new Set()); }}
                    />
                  </th>
                  {visibleCols.map((col) => (
                    <th key={col.id}
                      className={`px-4 py-3 font-medium text-gray-500 uppercase text-xs whitespace-nowrap tracking-wide ${col.align === 'center' ? 'text-center' : 'text-left'}`}
                      style={col.minWidth ? { minWidth: col.minWidth } : undefined}>
                      {col.label}
                    </th>
                  ))}
                  <th className="w-16 px-3 py-3 sticky right-0 bg-gray-50 z-10" style={{ boxShadow: '-4px 0 6px -4px rgba(0,0,0,0.08)' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={visibleCols.length + 2} className="text-center py-10 text-gray-400">
                      No contacts match your search.
                    </td>
                  </tr>
                ) : (
                  filtered.map((contact) => {
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
                            case 'species': return (
                              <td key={col.id} className="px-4 py-3">
                                {contact.species ? (
                                  <span className="text-xs px-2.5 py-0.5 rounded font-medium whitespace-nowrap inline-block" style={{
                                    backgroundColor: ['Broilers','Layers','Primary Breeders','Turkeys'].includes(contact.species) ? '#E6F1FB' : contact.species === 'Ruminant' ? '#E1F5EE' : contact.species === 'Swines' ? '#FAEEDA' : contact.species === 'Aquaculture' ? '#E1F5EE' : contact.species?.includes('Consulting') ? '#EEEDFE' : '#F1EFE8',
                                    color: ['Broilers','Layers','Primary Breeders','Turkeys'].includes(contact.species) ? '#185FA5' : contact.species === 'Ruminant' ? '#0F6E56' : contact.species === 'Swines' ? '#854F0B' : contact.species === 'Aquaculture' ? '#0F6E56' : contact.species?.includes('Consulting') ? '#534AB7' : '#5F5E5A',
                                  }}>{contact.species}</span>
                                ) : <span className="text-gray-400">—</span>}
                              </td>
                            );
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
                            case 'owner': return <td key={col.id} className="px-4 py-3 text-sm text-gray-600">{contact.ownerName || getOwnerName(contact.ownerId)}</td>;
                            case 'position': return (
                              <td key={col.id} className="px-4 py-3 text-sm text-gray-500" title={contact.position || ''}>
                                {contact.position ? (contact.position.length > 25 ? contact.position.slice(0, 25) + '...' : contact.position) : '—'}
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white border border-gray-200 px-6 py-3 rounded-xl shadow-lg flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">{selectedIds.size} contact{selectedIds.size > 1 ? 's' : ''} selected</span>
          <button onClick={() => setShowBulkEmail(true)} className="px-4 py-1.5 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">Send Email</button>
          <button onClick={() => setShowBulkDelete(true)} className="px-4 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete Selected</button>
          <button onClick={() => setSelectedIds(new Set())} className="text-sm text-gray-400 hover:text-gray-600">Clear</button>
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
