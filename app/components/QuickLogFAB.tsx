'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useCRM } from '@/lib/CRMContext';
import { generateId, ActivityType } from '@/lib/data';
import AccountSearchSelect from './AccountSearchSelect';

const TYPES: { id: ActivityType; emoji: string }[] = [
  { id: 'Call', emoji: '📞' },
  { id: 'Meeting', emoji: '🤝' },
  { id: 'Email', emoji: '📧' },
  { id: 'Note', emoji: '📝' },
];

export default function QuickLogFAB() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const { addActivity } = useCRM();

  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<ActivityType>('Call');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Hide on login/signup or when not authenticated
  if (pathname === '/login' || pathname === '/signup') return null;
  if (status === 'unauthenticated') return null;

  function handleSave() {
    if (!subject.trim() || saving) return;
    setSaving(true);

    const activity = {
      id: generateId(),
      type,
      subject: subject.trim(),
      description: description.trim(),
      date: new Date().toISOString().split('T')[0],
      ownerId: session?.user?.id || '',
      accountId: accountId || '',
      contactId: '',
    };

    addActivity(activity);
    setSaved(true);
    setTimeout(() => {
      setIsOpen(false);
      setSaved(false);
      setSubject('');
      setDescription('');
      setAccountName('');
      setAccountId('');
      setType('Call');
    }, 1200);
  }

  return (
    <>
      {/* FAB Button — always visible */}
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: '28px',
          right: '28px',
          zIndex: 9999,
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: '#1a4731',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          fontSize: '30px',
          fontWeight: 300,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(26,71,49,0.45)',
        }}
        title="Quick Log Activity"
      >
        +
      </button>

      {/* Quick Log Modal */}
      {isOpen && (
        <div
          onClick={(e) => e.target === e.currentTarget && setIsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '440px',
              padding: '20px',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 500 }}>
                Quick Log
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '18px',
                  color: '#888',
                }}
              >
                ✕
              </button>
            </div>

            {/* Type selector */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '8px',
                marginBottom: '14px',
              }}
            >
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  style={{
                    padding: '10px 4px',
                    borderRadius: '10px',
                    border:
                      type === t.id
                        ? '2px solid #1a4731'
                        : '1px solid #e5e7eb',
                    background: type === t.id ? '#f0f7ee' : 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span style={{ fontSize: '20px' }}>{t.emoji}</span>
                  <span
                    style={{
                      fontSize: '11px',
                      color: type === t.id ? '#1a4731' : '#666',
                      fontWeight: type === t.id ? 500 : 400,
                    }}
                  >
                    {t.id}
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') setIsOpen(false);
              }}
              placeholder="Subject (required)"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                marginBottom: '10px',
                boxSizing: 'border-box',
              }}
            />

            {/* Account search */}
            <div style={{ marginBottom: '10px' }}>
              <AccountSearchSelect
                value={accountName}
                onChange={(name, id) => {
                  setAccountName(name);
                  setAccountId(id);
                }}
                placeholder="Related account (optional)"
              />
            </div>

            {/* Notes */}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes (optional)"
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '13px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                marginBottom: '16px',
                resize: 'none',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
              }}
            >
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  background: 'white',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!subject.trim() || saving || saved}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: saved
                    ? '#1D9E75'
                    : subject.trim()
                      ? '#1a4731'
                      : '#e5e7eb',
                  color: subject.trim() || saved ? 'white' : '#aaa',
                  cursor: subject.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                {saved ? '✓ Logged!' : saving ? 'Saving...' : 'Log Activity'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
