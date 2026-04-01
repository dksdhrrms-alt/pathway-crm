'use client';

import { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Task, Priority, generateId } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';

interface NewTaskModalProps {
  defaultAccountId?: string;
  defaultContactId?: string;
  defaultOpportunityId?: string;
  onClose: () => void;
  onSave: (task: Task) => void;
}

const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];

export default function NewTaskModal({
  defaultAccountId = '',
  defaultContactId = '',
  defaultOpportunityId = '',
  onClose,
  onSave,
}: NewTaskModalProps) {
  const { data: session } = useSession();
  const { accounts: allAccounts, contacts: allContacts, addTask } = useCRM();
  const { users: allUsers } = useUsers();

  const userId = session?.user?.id ?? '';
  const isAdmin = ['administrative_manager','admin','ceo','sales_director','coo'].includes(session?.user?.role ?? '');
  const accounts = allAccounts; // All users see all accounts

  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().split('T')[0]);
  const [priority, setPriority] = useState<Priority>('Medium');
  const [relatedAccountId, setRelatedAccountId] = useState(defaultAccountId);
  const [relatedContactId, setRelatedContactId] = useState(defaultContactId);
  const [description, setDescription] = useState('');
  const [ownerId, setOwnerId] = useState(userId);
  const [error, setError] = useState('');

  const filteredContacts = relatedAccountId
    ? allContacts.filter((c) => c.accountId === relatedAccountId)
    : allContacts; // All users see all contacts

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) {
      setError('Subject is required.');
      return;
    }
    const newTask: Task = {
      id: generateId(),
      subject: subject.trim(),
      dueDate,
      priority,
      status: 'Open',
      ownerId,
      relatedAccountId: relatedAccountId || undefined,
      relatedContactId: relatedContactId || undefined,
      relatedOpportunityId: defaultOpportunityId || undefined,
      description: description.trim() || undefined,
    };
    addTask(newTask);
    onSave(newTask);
    onClose();
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
          <h2 className="text-lg font-semibold text-gray-900">New Task</h2>
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setError(''); }}
              placeholder="Task subject"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Related Account</label>
            <select
              value={relatedAccountId}
              onChange={(e) => {
                setRelatedAccountId(e.target.value);
                setRelatedContactId('');
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">— None —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Related Contact</label>
            <select
              value={relatedContactId}
              onChange={(e) => setRelatedContactId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">— None —</option>
              {filteredContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </select>
          </div>

          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#1a4731' }}
            >
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
