'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useScrollRestore } from '@/hooks/useUrlState';
import { Account } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import TopBar from '@/app/components/TopBar';
import NewAccountModal from '@/app/components/NewAccountModal';
import Toast from '@/app/components/Toast';
import LoadingSpinner from '@/app/components/LoadingSpinner';
import ImportModal from '@/app/components/ImportModal';
import EditAccountModal from '@/app/components/EditAccountModal';

const FLAGS: Record<string, string> = {
  USA: '🇺🇸', Mexico: '🇲🇽', Colombia: '🇨🇴', Peru: '🇵🇪', Panama: '🇵🇦',
  'El Salvador': '🇸🇻', UK: '🇬🇧', Korea: '🇰🇷', Guatemala: '🇬🇹',
  Brazil: '🇧🇷', Ecuador: '🇪🇨', Bolivia: '🇧🇴',
};

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

type SortKey = 'name' | 'industry' | 'country' | 'employee';
type SortDir = 'asc' | 'desc';

export default function AccountsPage() {
  useScrollRestore();
  const { data: session } = useSession();
  const isAdmin = ['administrative_manager', 'admin', 'ceo', 'sales_director', 'coo'].includes(session?.user?.role ?? '');
  const userId = session?.user?.id ?? '';

  const { accounts: allAccounts, contacts, deleteAccount, deleteAccountsBulk, loading } = useCRM();
  const { users } = useUsers();
  void users;

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

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const ownerOptions = useMemo(() => {
    const ids = [...new Set(accounts.map((a) => a.ownerId).filter(Boolean))];
    return ids.map((id) => ({ id, name: users.find((u) => u.id === id)?.name || id })).sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts, users]);

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
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [accounts, search, sortKey, sortDir, ownerFilter]);

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
          <div className="mt-6 mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
              <p className="text-sm text-gray-500 mt-0.5">{accounts.length} account{accounts.length !== 1 ? 's' : ''}{isAdmin ? ' total' : ''}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                <option value="all">All Owners ({accounts.length})</option>
                {ownerOptions.map((o) => {
                  const count = accounts.filter((a) => a.ownerId === o.id).length;
                  return <option key={o.id} value={o.id}>{o.name} ({count})</option>;
                })}
              </select>
              <button onClick={() => setShowImportModal(true)} className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">+ Import</button>
              <button onClick={() => setShowNewModal(true)} className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>+ New Account</button>
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
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs cursor-pointer select-none" onClick={() => toggleSort('name')}>Account Name{sortArrow('name')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs cursor-pointer select-none" style={{ minWidth: 120 }} onClick={() => toggleSort('industry')}>Species{sortArrow('industry')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">Sales Owner</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs cursor-pointer select-none" onClick={() => toggleSort('country')}>Country{sortArrow('country')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">Telephone</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 uppercase text-xs cursor-pointer select-none" onClick={() => toggleSort('employee')}>Employee{sortArrow('employee')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">Website</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">Address</th>
                  <th className="w-16 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-10 text-gray-400">No accounts match your search.</td></tr>
                ) : filtered.map((acct) => {
                  const badge = SPECIES_BADGE[acct.industry] || SPECIES_BADGE.Other;
                  const isSelected = selectedIds.has(acct.id);
                  return (
                    <tr key={acct.id} className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors group ${isSelected ? 'bg-green-50/40' : ''}`}>
                      <td className="px-3 py-3">
                        <input type="checkbox" className="rounded border-gray-300" checked={isSelected}
                          onChange={(e) => { const n = new Set(selectedIds); if (e.target.checked) n.add(acct.id); else n.delete(acct.id); setSelectedIds(n); }} />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/accounts/${acct.id}`} className="font-medium hover:underline" style={{ color: '#1a4731' }}>{acct.name}</Link>
                      </td>
                      <td className="px-4 py-3" style={{ minWidth: 120 }}>
                        {acct.industry ? (
                          <span className="text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap inline-block" style={{ backgroundColor: badge?.bg, color: badge?.text }}>{acct.industry}</span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {acct.ownerName ? (
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0" style={{ backgroundColor: '#1a4731' }}>
                              {ownerInitials(acct.ownerName)}
                            </div>
                            <span className="text-sm text-gray-800">{acct.ownerName}</span>
                          </div>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm">{acct.country ? <span>{FLAGS[acct.country] ?? '🌐'} {acct.country}</span> : <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{acct.phone || '—'}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-600">{acct.employee ?? '—'}</td>
                      <td className="px-4 py-3 text-sm">
                        {acct.website ? <a href={acct.website.startsWith('http') ? acct.website : `https://${acct.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block max-w-[130px]">{stripUrl(acct.website)}</a> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500" title={acct.location || ''}>
                        {acct.location ? (acct.location.length > 35 ? acct.location.slice(0, 35) + '...' : acct.location) : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditAccountId(acct.id)} className="p-1 rounded text-gray-300 hover:text-blue-500 hover:bg-blue-50" aria-label="Edit">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button onClick={() => setConfirmDeleteId(acct.id)} className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50" aria-label="Delete">
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
