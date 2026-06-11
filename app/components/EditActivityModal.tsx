'use client';

/**
 * Edit an existing Activity from the Archive (or anywhere else).
 *
 * Smaller, more focused than LogActivityModal — the user already has
 * the activity context (they clicked the row), so we just expose the
 * editable fields. Delete option is included for soft cleanup of typos
 * or mistaken logs.
 *
 * Fields editable here:
 *   - type (Call / Meeting / Email / Note)
 *   - date
 *   - subject
 *   - description (with voice transcription)
 *   - purpose
 *   - account
 *   - contact (single — multi-select would complicate the edit flow)
 */

import { useEffect, useState } from 'react';
import type { Activity, ActivityType } from '@/lib/data';
import { ACTIVITY_PURPOSES } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import VoiceInputButton from './VoiceInputButton';
import SubmitButton from './SubmitButton';
import CommentThread from './CommentThread';

const ACTIVITY_TYPES: ActivityType[] = ['Call', 'Meeting', 'Email', 'Note'];
const TYPE_LABEL: Record<ActivityType, string> = {
  Call: 'Call / Text Message', Meeting: 'Meeting', Email: 'Email', Note: 'Note',
};

interface Props {
  activity: Activity;
  onClose: () => void;
}

export default function EditActivityModal({ activity, onClose }: Props) {
  const { accounts, contacts, updateActivity, deleteActivity } = useCRM();

  const [type, setType] = useState<ActivityType>(activity.type);
  const [subject, setSubject] = useState(activity.subject);
  const [description, setDescription] = useState(activity.description ?? '');
  const [date, setDate] = useState(activity.date);
  const [purpose, setPurpose] = useState(activity.purpose ?? '');
  const [accountId, setAccountId] = useState(activity.accountId ?? '');
  const [contactId, setContactId] = useState(activity.contactId ?? '');
  const [contactSearch, setContactSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !submitting) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // When account changes, narrow the contact list.
  // When no account, fall back to search-as-you-type for contacts.
  const availableContacts = accountId
    ? contacts.filter((c) => c.accountId === accountId)
    : contactSearch.trim().length > 0
      ? contacts
          .filter((c) => `${c.firstName} ${c.lastName}`.toLowerCase().includes(contactSearch.toLowerCase().trim()))
          .slice(0, 20)
      : [];

  // Make sure the currently-selected contact stays visible even if it's
  // not in the filtered list (e.g. when account was changed mid-edit).
  const selectedContact = contacts.find((c) => c.id === contactId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedSubject = subject.trim();
    if (!trimmedSubject) { setError('Subject is required.'); return; }
    if (!date) { setError('Date is required.'); return; }

    setSubmitting(true);
    // updateActivity is fire-and-forget (optimistic) — but we close on
    // the next tick so the user sees the spinner briefly. CRMContext
    // surfaces errors via toast if the DB write fails after the modal
    // has already closed.
    updateActivity(activity.id, {
      type,
      subject: trimmedSubject,
      description: description.trim() || undefined,
      date,
      purpose: purpose || undefined,
      accountId: accountId || undefined,
      contactId: contactId || undefined,
    });
    setTimeout(() => { onClose(); }, 150);
  }

  function handleDelete() {
    if (!confirm(`Delete this activity?\n\n"${activity.subject}"\n\nThis cannot be undone from the UI.`)) return;
    setSubmitting(true);
    deleteActivity(activity.id);
    setTimeout(() => { onClose(); }, 150);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
     
      tabIndex={-1}
    >
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Edit activity</h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Type pills */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Type</label>
            <div className="grid grid-cols-4 gap-2">
              {ACTIVITY_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    type === t
                      ? 'border-green-500 bg-green-50 text-green-700 dark:border-green-500 dark:bg-green-950/30 dark:text-green-300'
                      : 'border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Purpose</label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">— Purpose (optional) —</option>
                {ACTIVITY_PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Subject <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Account</label>
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                // If contact is from a different account, clear it.
                const c = contacts.find((x) => x.id === contactId);
                if (c && c.accountId !== e.target.value) setContactId('');
              }}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">— No account —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Contact</label>
            {!accountId && (
              <input
                type="text"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Search a contact..."
                className="w-full mb-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            )}
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">— No contact —</option>
              {selectedContact && !availableContacts.find((c) => c.id === selectedContact.id) && (
                <option value={selectedContact.id}>{selectedContact.firstName} {selectedContact.lastName} (current)</option>
              )}
              {availableContacts.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Description</label>
              <VoiceInputButton
                size="sm"
                onTranscript={(text) => setDescription((prev) => prev ? `${prev} ${text}` : text)}
                title="Dictate notes via Whisper AI"
              />
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>

          {error && (
            <div role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={submitting}
              className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50"
            >
              Delete
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <SubmitButton type="submit" pending={submitting}>Save</SubmitButton>
            </div>
          </div>
        </form>

        {/*
         * Replies thread — same CommentThread we render on the Contact /
         * Account pages. Lives below the edit form so the modal becomes a
         * one-stop spot to both fix details and discuss the activity
         * (handy from Archive where users come back to triage older logs).
         */}
        <div className="mt-6 pt-4 border-t border-gray-100 dark:border-slate-800">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
            Replies
          </div>
          <CommentThread parentType="activity" parentId={activity.id} />
        </div>
      </div>
    </div>
  );
}
