'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Activity, ActivityType, ACTIVITY_PURPOSES, generateId } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import VoiceInputButton from './VoiceInputButton';
import SubmitButton from './SubmitButton';

interface LogActivityModalProps {
  accountId?: string;
  contactId?: string;
  defaultType?: ActivityType;
  onClose: () => void;
  onSave: (activity: Activity) => void;
}

const ACTIVITY_TYPES: ActivityType[] = ['Call', 'Meeting', 'Email', 'Note'];
const TYPE_LABEL: Record<ActivityType, string> = { Call: 'Call / Text Message', Meeting: 'Meeting', Email: 'Email', Note: 'Note' };

export default function LogActivityModal({
  accountId: initialAccountId,
  contactId,
  defaultType = 'Call',
  onClose,
  onSave,
}: LogActivityModalProps) {
  const { data: session } = useSession();
  const { addActivity, accounts, contacts } = useCRM();
  const { users: allUsers } = useUsers();

  const userId = session?.user?.id ?? '';
  const isAdmin = ['administrative_manager','admin','ceo','sales_director','coo'].includes(session?.user?.role ?? '');

  const [type, setType] = useState<ActivityType>(defaultType);
  const [purpose, setPurpose] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [ownerId, setOwnerId] = useState(userId);
  const [accountId, setAccountId] = useState(initialAccountId || '');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(
    new Set(contactId ? [contactId] : [])
  );
  const [contactSearch, setContactSearch] = useState('');
  const [internalParticipants, setInternalParticipants] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  // Guards against double-submit (button still visible during the brief
  // window between click and the parent closing the modal via onSave).
  const [submitting, setSubmitting] = useState(false);

  const activeUsers = allUsers.filter((u) => u.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
  function toggleParticipant(id: string) {
    setInternalParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // When account selected: show all contacts of that account
  // When no account: only show contacts matching search query
  const availableContacts = accountId
    ? contacts.filter((c) => c.accountId === accountId)
    : contactSearch.trim().length > 0
      ? contacts.filter((c) => `${c.firstName} ${c.lastName}`.toLowerCase().includes(contactSearch.toLowerCase().trim())).slice(0, 20)
      : [];

  // Selected contacts (for showing already-picked items even when search clears)
  const selectedContactObjs = contacts.filter((c) => selectedContactIds.has(c.id));

  function toggleContact(id: string) {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!subject.trim()) {
      setError('Subject is required.');
      return;
    }

    setSubmitting(true);
    try {
      const ids = Array.from(selectedContactIds);
      // If no contacts selected, create one activity with no contact
      const contactList: (string | undefined)[] = ids.length > 0 ? ids : [undefined];
      let last: Activity | null = null;
      contactList.forEach((cid) => {
        const newActivity: Activity = {
          id: generateId(),
          type,
          subject: subject.trim(),
          description: description.trim(),
          date,
          ownerId,
          accountId: accountId || '',
          contactId: cid,
          purpose: purpose || undefined,
          internalParticipants: internalParticipants.size > 0 ? Array.from(internalParticipants) : undefined,
        };
        addActivity(newActivity);
        last = newActivity;
      });
      if (last) onSave(last);
      onClose();
    } catch (err) {
      console.error('LogActivityModal submit failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to save: ${msg}`);
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      tabIndex={-1}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Log Activity</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ActivityType)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Purpose <span className="text-gray-400 text-xs">(optional)</span></label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">— Select purpose —</option>
                {ACTIVITY_PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account {!initialAccountId && <span className="text-gray-400 text-xs">(optional)</span>}</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">— No account —</option>
              {[...accounts].sort((a, b) => a.name.localeCompare(b.name)).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contacts <span className="text-gray-400 text-xs">(select multiple — one activity per contact)</span>
            </label>

            {/* Selected contact chips */}
            {selectedContactObjs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedContactObjs.map((c) => (
                  <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-xs text-green-700 border border-green-200">
                    {c.firstName} {c.lastName}
                    <button type="button" onClick={() => toggleContact(c.id)} className="text-green-600 hover:text-green-800 font-bold ml-1" aria-label="Remove">×</button>
                  </span>
                ))}
              </div>
            )}

            {/* Search input when no account, otherwise show account contacts directly */}
            {!accountId && (
              <input
                type="text"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Search contacts by name..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-1.5"
              />
            )}

            {availableContacts.length === 0 ? (
              <div className="text-xs text-gray-400 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50">
                {accountId ? 'No contacts for this account.' : contactSearch ? 'No contacts match search.' : 'Type to search contacts...'}
              </div>
            ) : (
              <div className="border border-gray-300 rounded-lg max-h-32 overflow-y-auto">
                {[...availableContacts].sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)).map((c) => {
                  const acctName = accounts.find((a) => a.id === c.accountId)?.name;
                  return (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-50 last:border-b-0">
                    <input type="checkbox" checked={selectedContactIds.has(c.id)} onChange={() => toggleContact(c.id)}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                    <span className="font-medium">{c.firstName} {c.lastName}</span>
                    {c.title && <span className="text-xs text-gray-400">· {c.title}</span>}
                    {!accountId && acctName && <span className="text-xs text-blue-600">· {acctName}</span>}
                    {c.isKeyMan && <span className="text-amber-500 text-xs">★</span>}
                  </label>
                  );
                })}
              </div>
            )}
            {selectedContactIds.size > 0 && (
              <p className="text-xs text-gray-500 mt-1">{selectedContactIds.size} contact{selectedContactIds.size > 1 ? 's' : ''} selected — will create {selectedContactIds.size} {selectedContactIds.size > 1 ? 'separate activities' : 'activity'}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setError(''); }}
              placeholder="Brief summary of the activity"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Description</label>
              <VoiceInputButton
                size="sm"
                onTranscript={(text) => setDescription((prev) => prev ? `${prev} ${text}` : text)}
                title="Click to dictate notes via Whisper AI"
              />
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed notes... (or click 🎤 to dictate)"
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Internal Participants <span className="text-gray-400 text-xs">(team members who joined)</span>
            </label>
            {internalParticipants.size > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {Array.from(internalParticipants).map((id) => {
                  const u = activeUsers.find((x) => x.id === id);
                  if (!u) return null;
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-xs text-blue-700 border border-blue-200">
                      {u.name}
                      <button type="button" onClick={() => toggleParticipant(id)} className="text-blue-600 hover:text-blue-800 font-bold ml-1" aria-label="Remove">×</button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="border border-gray-300 rounded-lg max-h-32 overflow-y-auto">
              {activeUsers.filter((u) => u.id !== ownerId).map((u) => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-50 last:border-b-0">
                  <input type="checkbox" checked={internalParticipants.has(u.id)} onChange={() => toggleParticipant(u.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span className="font-medium">{u.name}</span>
                </label>
              ))}
            </div>
            {internalParticipants.size > 0 && (
              <p className="text-xs text-gray-500 mt-1">{internalParticipants.size} participant{internalParticipants.size > 1 ? 's' : ''} selected</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Logged By</label>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <SubmitButton type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </SubmitButton>
            <SubmitButton type="submit" pending={submitting} pendingText="Logging...">
              Save Activity
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
