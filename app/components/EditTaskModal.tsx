'use client';

import { useState } from 'react';
import { Task, Priority } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import AccountSearchSelect from './AccountSearchSelect';
import SubmitButton from './SubmitButton';

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];

interface Props {
  task: Task;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditTaskModal({ task, onClose, onSaved }: Props) {
  const { updateTask } = useCRM();
  const { accounts, contacts } = useCRM();

  const [subject, setSubject] = useState(task.subject);
  const [dueDate, setDueDate] = useState(task.dueDate);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [status, setStatus] = useState(task.status);
  const [relatedAccountId, setRelatedAccountId] = useState(task.relatedAccountId || '');
  const [relatedContactId, setRelatedContactId] = useState(task.relatedContactId || '');
  const [description, setDescription] = useState(task.description || '');
  const [error, setError] = useState('');
  // Guards against double-submit (button still visible during the brief
  // window between click and the parent closing the modal via onSaved).
  const [submitting, setSubmitting] = useState(false);

  const accountName = accounts.find((a) => a.id === relatedAccountId)?.name || '';
  const filteredContacts = relatedAccountId ? contacts.filter((c) => c.accountId === relatedAccountId) : contacts;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!subject.trim()) { setError('Subject is required.'); return; }

    setSubmitting(true);
    try {
      const updates: Partial<Task> = {
        subject: subject.trim(), dueDate, priority, status, description: description.trim(),
        relatedAccountId: relatedAccountId || undefined,
        relatedContactId: relatedContactId || undefined,
      };

      updateTask(task.id, updates);
      onSaved();
      onClose();
    } catch (err) {
      console.error('EditTaskModal save failed:', err);
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Edit Task</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Subject *</label>
            <input type="text" value={subject} onChange={(e) => { setSubject(e.target.value); setError(''); }}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Due Date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as 'Open' | 'Completed')}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="Open">Open</option>
              <option value="Completed">Completed</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Related Account</label>
            <AccountSearchSelect value={accountName} onChange={(_, id) => { setRelatedAccountId(id); setRelatedContactId(''); }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Related Contact</label>
            <select value={relatedContactId} onChange={(e) => setRelatedContactId(e.target.value)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">— None —</option>
              {filteredContacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <SubmitButton type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</SubmitButton>
            <SubmitButton type="submit" pending={submitting} pendingText="Saving...">Save Changes</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
