'use client';

import { useState } from 'react';
import { Task, Priority } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import AccountSearchSelect from './AccountSearchSelect';
import SubmitButton from './SubmitButton';
import { Modal } from './ui';

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
  // Star flag — Weekly Report shows the full description when on.
  const [isImportant, setIsImportant] = useState(!!task.isImportant);
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
        isImportant,
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
    <Modal onClose={onClose} size="lg">
      <Modal.Header title="Edit Task" onClose={onClose} />
      <Modal.Body>
        <form onSubmit={handleSave} className="space-y-4" id="edit-task-form">
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
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y" />
            <button
              type="button"
              onClick={() => setIsImportant((v) => !v)}
              className={`mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition ${
                isImportant
                  ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                  : 'border-gray-300 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800'
              }`}
              title="Star this task so the full description shows up in the Weekly Report"
            >
              <span className="text-base leading-none">{isImportant ? '★' : '☆'}</span>
              <span>{isImportant ? 'Weekly Report: full detail' : 'Mark as important for Weekly Report'}</span>
            </button>
          </div>
        </form>
      </Modal.Body>
      <Modal.Footer>
        <SubmitButton type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</SubmitButton>
        <SubmitButton type="submit" form="edit-task-form" pending={submitting} pendingText="Saving...">Save Changes</SubmitButton>
      </Modal.Footer>
    </Modal>
  );
}
