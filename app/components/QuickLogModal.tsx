'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useCRM } from '@/lib/CRMContext';
import { generateId, ActivityType } from '@/lib/data';
import AccountSearchSelect from './AccountSearchSelect';

const ACTIVITY_TYPES: { id: ActivityType; emoji: string; label: string }[] = [
  { id: 'Call', emoji: '📞', label: 'Call' },
  { id: 'Meeting', emoji: '🤝', label: 'Meeting' },
  { id: 'Email', emoji: '📧', label: 'Email' },
  { id: 'Note', emoji: '📝', label: 'Note' },
];

interface Props {
  onClose: () => void;
  initialType?: ActivityType;
}

export default function QuickLogModal({ onClose, initialType }: Props) {
  const { data: session } = useSession();
  const { addActivity } = useCRM();

  const [type, setType] = useState<ActivityType>(initialType || 'Call');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    if (!subject.trim() || saving) return;
    setSaving(true);

    const activity = {
      id: generateId(),
      type,
      subject: subject.trim(),
      description: description.trim(),
      date,
      ownerId: session?.user?.id || '',
      accountId: accountId || '',
      contactId: '',
    };

    addActivity(activity);
    setSaved(true);
    setTimeout(() => onClose(), 1200);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm p-0 md:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white w-full md:max-w-[480px] md:rounded-2xl rounded-t-2xl p-5 pb-8 md:pb-5 border-t md:border border-gray-200 shadow-xl animate-slideUp">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-[15px] font-semibold text-gray-900">Quick Log</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {session?.user?.name} &middot;{' '}
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg p-1 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Activity Type selector */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {ACTIVITY_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              className={`py-2.5 px-1 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                type === t.id
                  ? 'border-[#1a4731] bg-green-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <span className="text-xl">{t.emoji}</span>
              <span
                className={`text-[11px] ${
                  type === t.id ? 'font-semibold text-[#1a4731]' : 'text-gray-500'
                }`}
              >
                {t.label}
              </span>
            </button>
          ))}
        </div>

        {/* Subject */}
        <input
          autoFocus
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={`${type} subject... (required)`}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />

        {/* Account search */}
        <div className="mb-3">
          <AccountSearchSelect
            value={accountName}
            onChange={(name, id) => {
              setAccountName(name);
              setAccountId(id);
            }}
            placeholder="Related account (optional)..."
          />
        </div>

        {/* Notes */}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Quick notes... (optional)"
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mb-3 resize-none focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />

        {/* Date */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-gray-400">Date:</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="text-xs border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center">
          <span className="text-[11px] text-gray-300 hidden md:inline">
            Ctrl + Enter to save
          </span>
          <span className="md:hidden" />

          {saved ? (
            <span className="text-sm font-semibold text-[#1a4731] flex items-center gap-1.5">
              ✓ Logged!
            </span>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!subject.trim() || saving}
                className="px-5 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: subject.trim() && !saving ? '#1a4731' : '#9ca3af' }}
              >
                {saving ? 'Saving...' : 'Log Activity'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
