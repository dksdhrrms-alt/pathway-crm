'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useScrollRestore } from '@/hooks/useUrlState';
import { Contact, generateId } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import SendEmailModal from '@/app/components/SendEmailModal';
import { useUsers } from '@/lib/UserContext';
import TopBar from '@/app/components/TopBar';
import NewContactModal from '@/app/components/NewContactModal';
import Toast from '@/app/components/Toast';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import ImportModal from '@/app/components/ImportModal';
import EditContactModal from '@/app/components/EditContactModal';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ContactsPage() {
  const { data: session } = useSession();
  const isAdmin = ['administrative_manager','admin','ceo','sales_director','coo'].includes(session?.user?.role ?? '');
  const userId = session?.user?.id ?? '';

  const { contacts: allContacts, accounts: allAccounts, getActivitiesForContact, deleteContact, deleteContactsBulk, addActivity, loading } = useCRM();
  useScrollRestore(!loading && allContacts.length > 0);
  const { users } = useUsers();

  function getOwnerName(ownerId: string): string {
    const user = users.find((u) => u.id === ownerId);
    return user ? user.name : '—';
  }

  const contacts = useMemo(() => {
    return allContacts; // All users see all contacts
  }, [allContacts, allAccounts, isAdmin, userId]);

  const [search, setSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkEmail, setShowBulkEmail] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

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

  if (loading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar searchValue={search} onSearchChange={setSearch} placeholder="Search contacts or accounts..." />

      <main className="pt-16 px-6 pb-10">
        <div className="max-w-7xl mx-auto">
          <div className="mt-6 mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
              <p className="text-sm text-gray-500 mt-0.5">{contacts.length} contact{contacts.length !== 1 ? 's' : ''}{isAdmin ? ' total' : ' (your accounts)'}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowImportModal(true)}
                className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                + Import
              </button>
              <button
                onClick={() => setShowNewModal(true)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1a4731' }}
              >
                + New Contact
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" className="rounded border-gray-300"
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds(new Set(filtered.map(c => c.id)));
                        else setSelectedIds(new Set());
                      }}
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide" style={{ minWidth: 160 }}>Species</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Country</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Owner</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Position</th>
                  <th className="text-center px-3 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Key</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs tracking-wide">Tel</th>
                  <th className="w-10 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-10 text-gray-400">
                      No contacts match your search.
                    </td>
                  </tr>
                ) : (
                  filtered.map((contact) => {
                    const account = allAccounts.find((a) => a.id === contact.accountId);
                    const acts = getActivitiesForContact(contact.id);
                    const lastActivity = acts.length > 0 ? acts[0].date : null;
                    return (
                      <tr
                        key={contact.id}
                        className="border-b border-gray-50 hover:bg-green-50/30 transition-colors group"
                      >
                        <td className="px-4 py-3.5">
                          <input type="checkbox" className="rounded border-gray-300"
                            checked={selectedIds.has(contact.id)}
                            onChange={(e) => {
                              const next = new Set(selectedIds);
                              if (e.target.checked) next.add(contact.id);
                              else next.delete(contact.id);
                              setSelectedIds(next);
                            }}
                          />
                        </td>
                        {/* Name */}
                        <td className="px-4 py-3">
                          <Link href={`/contacts/${contact.id}`} className="font-semibold hover:underline" style={{ color: '#1a4731' }}>
                            {contact.firstName} {contact.lastName}
                          </Link>
                        </td>
                        {/* Species */}
                        <td className="px-4 py-3" style={{ minWidth: 160 }}>
                          {contact.species ? (
                            <span className="text-xs px-2.5 py-0.5 rounded font-medium whitespace-nowrap inline-block" style={{
                              backgroundColor: ['Broilers','Layers','Primary Breeders','Turkeys'].includes(contact.species) ? '#E6F1FB' : contact.species === 'Ruminant' ? '#E1F5EE' : contact.species === 'Swines' ? '#FAEEDA' : contact.species === 'Aquaculture' ? '#E1F5EE' : contact.species?.includes('Consulting') ? '#EEEDFE' : '#F1EFE8',
                              color: ['Broilers','Layers','Primary Breeders','Turkeys'].includes(contact.species) ? '#185FA5' : contact.species === 'Ruminant' ? '#0F6E56' : contact.species === 'Swines' ? '#854F0B' : contact.species === 'Aquaculture' ? '#0F6E56' : contact.species?.includes('Consulting') ? '#534AB7' : '#5F5E5A',
                            }}>{contact.species}</span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        {/* Company */}
                        <td className="px-4 py-3">
                          {account ? (
                            <Link href={`/accounts/${account.id}`} className="text-sm hover:underline" style={{ color: '#2d6a4f' }}>{account.name}</Link>
                          ) : contact.accountName ? (
                            <span className="text-gray-500 text-sm">{contact.accountName}</span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        {/* Country */}
                        <td className="px-4 py-3 text-sm">
                          {contact.country ? (
                            <span>{({'USA':'🇺🇸','Mexico':'🇲🇽','UK':'🇬🇧','Colombia':'🇨🇴','Peru':'🇵🇪','Panama':'🇵🇦','El Salvador':'🇸🇻','Korea':'🇰🇷'} as Record<string,string>)[contact.country] ?? '🌐'} {contact.country}</span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        {/* Owner */}
                        <td className="px-4 py-3 text-sm text-gray-600">{contact.ownerName || getOwnerName(contact.ownerId)}</td>
                        {/* Position */}
                        <td className="px-4 py-3 text-sm text-gray-500" title={contact.position || ''}>
                          {contact.position ? (contact.position.length > 25 ? contact.position.slice(0, 25) + '...' : contact.position) : '—'}
                        </td>
                        {/* Key Man */}
                        <td className="px-3 py-3 text-center" title={contact.isKeyMan ? 'Key contact' : 'Not a key contact'}>
                          <span className={contact.isKeyMan ? 'text-amber-500' : 'text-gray-300'}>{contact.isKeyMan ? '★' : '☆'}</span>
                        </td>
                        {/* Email */}
                        <td className="px-4 py-3 text-sm">
                          {contact.email ? (
                            <a href={`mailto:${contact.email}`} className="text-gray-500 hover:text-blue-600 truncate block max-w-[140px]" title={contact.email}>{contact.email}</a>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        {/* Tel */}
                        <td className="px-4 py-3 text-sm text-gray-500">{contact.phone || contact.tel || '—'}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditContactId(contact.id)} className="p-1 rounded text-gray-300 hover:text-blue-500 hover:bg-blue-50" aria-label="Edit">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(contact.id)}
                            className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50"
                            aria-label="Delete contact"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
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

      {showNewModal && (
        <NewContactModal
          onClose={() => setShowNewModal(false)}
          onSave={handleContactSaved}
        />
      )}

      {/* Confirm delete modal */}
      {confirmDeleteId && contactToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete Contact</h2>
            <p className="text-sm text-gray-600 mb-5">
              Are you sure you want to delete <strong>{contactToDelete.firstName} {contactToDelete.lastName}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white border border-gray-200 px-6 py-3 rounded-xl shadow-lg flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">{selectedIds.size} contact{selectedIds.size > 1 ? 's' : ''} selected</span>
          <button onClick={() => setShowBulkEmail(true)} className="px-4 py-1.5 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">
            Send Email
          </button>
          <button onClick={() => setShowBulkDelete(true)} className="px-4 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">
            Delete Selected
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-sm text-gray-400 hover:text-white">
            Clear
          </button>
        </div>
      )}

      {showBulkEmail && (
        <SendEmailModal
          recipients={
            allContacts
              .filter((c) => selectedIds.has(c.id) && c.email)
              .map((c) => ({ email: c.email, name: `${c.firstName} ${c.lastName}`, contactId: c.id }))
          }
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

      {showImportModal && (
        <ImportModal type="contacts" onClose={() => setShowImportModal(false)} onDone={(n) => { setShowImportModal(false); setToast(`${n} contacts imported`); }} />
      )}

      {showBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete {selectedIds.size} contacts?</h2>
            <p className="text-sm text-gray-600 mb-3">This will permanently remove {selectedIds.size} contacts and their linked activities.</p>
            <p className="text-xs text-red-600 mb-4">This cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowBulkDelete(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={() => { deleteContactsBulk(Array.from(selectedIds)); setToast(`${selectedIds.size} contacts deleted`); setSelectedIds(new Set()); setShowBulkDelete(false); }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete {selectedIds.size} Contacts</button>
            </div>
          </div>
        </div>
      )}

      {editContactId && (() => { const c = allContacts.find((x) => x.id === editContactId); return c ? <EditContactModal contact={c} onClose={() => setEditContactId(null)} onSaved={() => setToast('Contact updated successfully')} /> : null; })()}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
