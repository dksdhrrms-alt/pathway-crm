'use client';

import { useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Activity, ActivityType, ACTIVITY_PURPOSES, generateId, type Task } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import VoiceInputButton from './VoiceInputButton';
import SubmitButton from './SubmitButton';
import ActivityAttachmentsField, { type ActivityAttachmentsFieldHandle } from './ActivityAttachmentsField';

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
  const { addActivity, addTask, accounts, contacts } = useCRM();
  const { users: allUsers } = useUsers();

  const userId = session?.user?.id ?? '';
  const isAdmin = ['administrative_manager','admin','ceo','sales_director','coo'].includes(session?.user?.role ?? '');

  const [type, setType] = useState<ActivityType>(defaultType);
  const [purpose, setPurpose] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [ownerId, setOwnerId] = useState(userId);
  // "Logged By" defaults to self. Admins rarely need to log on behalf of
  // someone else, so the picker stays collapsed unless they ask for it.
  const [showLoggedBy, setShowLoggedBy] = useState(false);
  const [accountId, setAccountId] = useState(initialAccountId || '');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(
    new Set(contactId ? [contactId] : [])
  );
  const [contactSearch, setContactSearch] = useState('');
  const [internalParticipants, setInternalParticipants] = useState<Set<string>>(new Set());
  // Star flag → Weekly Report renders the full description verbatim.
  // Off by default so the report stays scannable; reps opt in per
  // activity when the meeting notes are worth surfacing to leadership.
  const [isImportant, setIsImportant] = useState(false);
  // Follow-up Action Item — same pattern as QuickLogModal. Default on;
  // typing nothing is a safe no-op (no Task created). See
  // data-migration/38-activity-action-item.sql for the DB side.
  const [createFollowUp, setCreateFollowUp] = useState(true);
  const [actionItem, setActionItem] = useState('');
  const [actionDueDate, setActionDueDate] = useState('');
  // Buffers queued files until after the activity row is created.
  // See ActivityAttachmentsField for the two-mode (pre-save / post-save)
  // lifecycle.
  const attachmentsRef = useRef<ActivityAttachmentsFieldHandle | null>(null);
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

  async function handleSubmit(e: React.FormEvent) {
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
      const createdIds: string[] = [];
      const actionItemText = actionItem.trim();
      const willCreateTask = createFollowUp && actionItemText.length > 0;
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
          isImportant,
          actionItem: willCreateTask ? actionItemText : undefined,
        };
        addActivity(newActivity);
        createdIds.push(newActivity.id);
        last = newActivity;
      });
      // Spawn a single follow-up Task tied to the first activity row.
      // Default due = activity date + 7 days ("I did X on Monday → remind
      // me next Monday"). Same shape as QuickLogModal so Director Weekly
      // Report / Tasks list treat the row identically.
      if (willCreateTask && createdIds[0]) {
        const due = actionDueDate || (() => {
          const base = new Date(date + 'T00:00:00');
          base.setDate(base.getDate() + 7);
          return base.toISOString().split('T')[0];
        })();
        const firstContactId = Array.from(selectedContactIds)[0];
        const taskPayload: Task = {
          id: generateId(),
          subject: actionItemText,
          dueDate: due,
          priority: 'Medium',
          status: 'Open',
          ownerId,
          relatedAccountId: accountId || undefined,
          relatedContactId: firstContactId || undefined,
          description: '',
          // Inherit the activity's star — if "the call matters" to the
          // rep, the follow-up Task should carry that signal into
          // Jason's Weekly Report too.
          isImportant,
          sourceActivityId: createdIds[0],
        };
        try { addTask(taskPayload); } catch (e) {
          console.error('[LogActivityModal] follow-up task create failed:', e);
        }
      }
      // Upload any queued attachments. If the rep logged against
      // multiple contacts we attach the files to the FIRST activity
      // row to avoid uploading the same PDF 5 times — the Activity
      // Timeline on sibling activities will still find them by their
      // own id but the files only live once in storage.
      if (createdIds.length > 0 && attachmentsRef.current?.hasPending()) {
        try {
          await attachmentsRef.current.uploadPending(createdIds[0], ownerId);
        } catch (err) {
          console.error('Attachment upload failed:', err);
          // The activity itself was saved — surface a non-fatal note
          // so the rep knows to re-attach via Edit.
          setError(`Activity saved, but attachment upload failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
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
     
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      tabIndex={-1}
    >
      {/*
        max-h-[90vh] + overflow-y-auto: the form has grown long (account,
        contacts list, subject, description, internal-participants
        checkboxes, date, …) and used to overflow the viewport on
        smaller screens — Save/Cancel buttons at the bottom would be
        unreachable. Cap the modal at 90% of viewport height and scroll
        inside the modal itself, so the backdrop stays fully covered
        and the user can always reach the footer.
      */}
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Log Activity</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ActivityType)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Purpose <span className="text-gray-400 dark:text-gray-500 text-xs">(optional)</span></label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">— Select purpose —</option>
                {ACTIVITY_PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Account {!initialAccountId && <span className="text-gray-400 dark:text-gray-500 text-xs">(optional)</span>}</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">— No account —</option>
              {[...accounts].sort((a, b) => a.name.localeCompare(b.name)).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Contacts <span className="text-gray-400 dark:text-gray-500 text-xs">(select multiple — one activity per contact)</span>
            </label>

            {/* Selected contact chips */}
            {selectedContactObjs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedContactObjs.map((c) => (
                  <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-950/40 text-xs text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                    {c.firstName} {c.lastName}
                    <button type="button" onClick={() => toggleContact(c.id)} className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 font-bold ml-1" aria-label="Remove">×</button>
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
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-1.5"
              />
            )}

            {availableContacts.length === 0 ? (
              <div className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-800">
                {accountId ? 'No contacts for this account.' : contactSearch ? 'No contacts match search.' : 'Type to search contacts...'}
              </div>
            ) : (
              <div className="border border-gray-300 dark:border-slate-600 rounded-lg max-h-32 overflow-y-auto">
                {[...availableContacts].sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)).map((c) => {
                  const acctName = accounts.find((a) => a.id === c.accountId)?.name;
                  return (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer text-sm border-b border-gray-50 dark:border-slate-700 last:border-b-0">
                    <input type="checkbox" checked={selectedContactIds.has(c.id)} onChange={() => toggleContact(c.id)}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                    <span className="font-medium dark:text-gray-100">{c.firstName} {c.lastName}</span>
                    {c.title && <span className="text-xs text-gray-400 dark:text-gray-500">· {c.title}</span>}
                    {!accountId && acctName && <span className="text-xs text-blue-600 dark:text-blue-400">· {acctName}</span>}
                    {c.isKeyMan && <span className="text-amber-500 text-xs">★</span>}
                  </label>
                  );
                })}
              </div>
            )}
            {selectedContactIds.size > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{selectedContactIds.size} contact{selectedContactIds.size > 1 ? 's' : ''} selected — will create {selectedContactIds.size} {selectedContactIds.size > 1 ? 'separate activities' : 'activity'}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Subject *</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setError(''); }}
              placeholder="Brief summary of the activity"
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Description</label>
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
              rows={7}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
            />
            {/* Star flag — one click marks the activity so leadership's
                Weekly Report carries the full description verbatim
                instead of just the meta bullet. */}
            <button
              type="button"
              onClick={() => setIsImportant((v) => !v)}
              className={`mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition ${
                isImportant
                  ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                  : 'border-gray-300 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800'
              }`}
              title="Star this activity so the full description shows up in the Weekly Report"
            >
              <span className="text-base leading-none">{isImportant ? '★' : '☆'}</span>
              <span>{isImportant ? 'Weekly Report: full detail' : 'Mark as important for Weekly Report'}</span>
            </button>
          </div>

          {/* ── Follow-up Action Item ──────────────────────────────
              Reps asked for a one-save flow: capture "what's next"
              in the same modal so a Task row is spawned automatically
              for Jason's Weekly Report Next Week column. Toggle off
              when there's no follow-up. */}
          <div className="rounded-lg border border-gray-200 dark:border-slate-700">
            <label className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none text-sm text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={createFollowUp} onChange={(e) => setCreateFollowUp(e.target.checked)}
                className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4" />
              <span className="font-medium">Add a follow-up task</span>
              <span className="text-[11px] text-gray-400 ml-auto">→ Weekly Report&apos;s Next Week</span>
            </label>
            {createFollowUp && (
              <div className="px-4 pb-4 pt-2 space-y-3">
                <textarea
                  value={actionItem}
                  onChange={(e) => setActionItem(e.target.value)}
                  placeholder="Action item — what will you do next?&#10;(e.g. Send pricing follow-up, confirm shipment timing)"
                  rows={3}
                  className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2.5 text-sm resize-y leading-relaxed" />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap font-medium">Due</label>
                  <input type="date" value={actionDueDate} onChange={(e) => setActionDueDate(e.target.value)}
                    className="flex-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
                  <span className="text-[11px] text-gray-400">(blank → +7 days)</span>
                </div>
              </div>
            )}
          </div>

          {/* Attachments — queued locally and uploaded in handleSubmit
              after the activity row is inserted. */}
          <ActivityAttachmentsField
            ref={attachmentsRef}
            uploadedBy={ownerId}
            onError={(msg) => setError(msg)}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Internal Participants <span className="text-gray-400 dark:text-gray-500 text-xs">(team members who joined)</span>
            </label>
            {internalParticipants.size > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {Array.from(internalParticipants).map((id) => {
                  const u = activeUsers.find((x) => x.id === id);
                  if (!u) return null;
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-xs text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      {u.name}
                      <button type="button" onClick={() => toggleParticipant(id)} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 font-bold ml-1" aria-label="Remove">×</button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="border border-gray-300 dark:border-slate-600 rounded-lg max-h-32 overflow-y-auto">
              {activeUsers.filter((u) => u.id !== ownerId).map((u) => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer text-sm border-b border-gray-50 dark:border-slate-700 last:border-b-0">
                  <input type="checkbox" checked={internalParticipants.has(u.id)} onChange={() => toggleParticipant(u.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span className="font-medium dark:text-gray-100">{u.name}</span>
                </label>
              ))}
            </div>
            {internalParticipants.size > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{internalParticipants.size} participant{internalParticipants.size > 1 ? 's' : ''} selected</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {isAdmin && (
            <div>
              {!showLoggedBy ? (
                <button
                  type="button"
                  onClick={() => setShowLoggedBy(true)}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 underline underline-offset-2"
                >
                  Log as someone else?
                </button>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Logged By</label>
                    <button
                      type="button"
                      onClick={() => { setShowLoggedBy(false); setOwnerId(userId); }}
                      className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                    >
                      Reset to me
                    </button>
                  </div>
                  <select
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    {allUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </>
              )}
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
