'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useCRM } from '@/lib/CRMContext';
import { generateId, ActivityType } from '@/lib/data';

const TYPES: { id: ActivityType; emoji: string }[] = [
  { id: 'Call', emoji: '📞' },
  { id: 'Meeting', emoji: '🤝' },
  { id: 'Email', emoji: '📧' },
  { id: 'Note', emoji: '📝' },
];

export default function QuickLogFAB() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const { accounts, contacts, addActivity } = useCRM();

  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<ActivityType>('Call');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  // Account search
  const [accountSearch, setAccountSearch] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [showAccountDD, setShowAccountDD] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  // Contact search
  const [contactSearch, setContactSearch] = useState('');
  const [contactId, setContactId] = useState('');
  const [showContactDD, setShowContactDD] = useState(false);
  const contactRef = useRef<HTMLDivElement>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setShowAccountDD(false);
      if (contactRef.current && !contactRef.current.contains(e.target as Node)) setShowContactDD(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (pathname === '/login' || pathname === '/signup') return null;
  if (status === 'unauthenticated') return null;

  const filteredAccounts = accounts
    .filter((a) => a.name.toLowerCase().includes(accountSearch.toLowerCase()))
    .slice(0, 8);

  const filteredContacts = contacts
    .filter((c) => {
      const name = `${c.firstName} ${c.lastName}`.toLowerCase();
      if (!name.includes(contactSearch.toLowerCase())) return false;
      if (accountId) return c.accountId === accountId;
      return true;
    })
    .slice(0, 8);

  function resetAll() {
    setIsOpen(false);
    setSaved(false);
    setSubject('');
    setDescription('');
    setAccountSearch('');
    setAccountName('');
    setAccountId('');
    setContactSearch('');
    setContactId('');
    setType('Call');
  }

  function handleSave() {
    if (!subject.trim() || saving) return;
    setSaving(true);

    addActivity({
      id: generateId(),
      type,
      subject: subject.trim(),
      description: description.trim(),
      date: new Date().toISOString().split('T')[0],
      ownerId: session?.user?.id || '',
      accountId: accountId || '',
      contactId: contactId || '',
    });

    setSaved(true);
    setTimeout(resetAll, 1200);
  }

  return (
    <>
      {/* FAB Button */}
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed', bottom: '28px', right: '28px', zIndex: 9999,
          width: '56px', height: '56px', borderRadius: '50%',
          background: '#1a4731', color: 'white', border: 'none',
          cursor: 'pointer', fontSize: '30px', fontWeight: 300,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(26,71,49,0.45)',
        }}
        title="Quick Log Activity"
      >
        +
      </button>

      {/* Modal */}
      {isOpen && (
        <div
          onClick={(e) => e.target === e.currentTarget && setIsOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            zIndex: 10000, display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: '16px',
          }}
        >
          <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '440px', padding: '20px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 500 }}>Quick Log</h3>
              <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#888' }}>
                ✕
              </button>
            </div>

            {/* Type selector */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  style={{
                    padding: '10px 4px', borderRadius: '10px',
                    border: type === t.id ? '2px solid #1a4731' : '1px solid #e5e7eb',
                    background: type === t.id ? '#f0f7ee' : 'white',
                    cursor: 'pointer', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: '4px',
                  }}
                >
                  <span style={{ fontSize: '20px' }}>{t.emoji}</span>
                  <span style={{ fontSize: '11px', color: type === t.id ? '#1a4731' : '#666', fontWeight: type === t.id ? 500 : 400 }}>
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
                if (e.key === 'Enter' && !showAccountDD && !showContactDD) handleSave();
                if (e.key === 'Escape') setIsOpen(false);
              }}
              placeholder="Subject (required)"
              style={{
                width: '100%', padding: '10px 12px', fontSize: '14px',
                border: '1px solid #e5e7eb', borderRadius: '8px',
                marginBottom: '10px', boxSizing: 'border-box',
              }}
            />

            {/* Account Search */}
            <div ref={accountRef} style={{ position: 'relative', marginBottom: '10px' }}>
              <input
                type="text"
                value={accountSearch}
                onChange={(e) => { setAccountSearch(e.target.value); setAccountName(e.target.value); setAccountId(''); setShowAccountDD(true); }}
                onFocus={() => { if (accountSearch) setShowAccountDD(true); }}
                placeholder="Search account (optional)..."
                style={{
                  width: '100%', padding: '10px 12px', paddingRight: accountName ? '32px' : '12px',
                  fontSize: '14px',
                  border: accountId ? '1px solid #1a4731' : '1px solid #e5e7eb',
                  borderRadius: '8px', boxSizing: 'border-box',
                  background: accountId ? '#f0f7ee' : 'white',
                }}
              />
              {accountName && (
                <button
                  onClick={() => { setAccountSearch(''); setAccountName(''); setAccountId(''); setContactSearch(''); setContactId(''); }}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px',
                  }}
                >
                  ×
                </button>
              )}
              {showAccountDD && accountSearch && filteredAccounts.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, background: 'white',
                  border: '1px solid #e5e7eb', borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10001,
                  maxHeight: '200px', overflowY: 'auto',
                }}>
                  {filteredAccounts.map((a) => (
                    <div
                      key={a.id}
                      onClick={() => { setAccountName(a.name); setAccountId(a.id); setAccountSearch(a.name); setShowAccountDD(false); setContactSearch(''); setContactId(''); }}
                      style={{
                        padding: '10px 14px', cursor: 'pointer', fontSize: '13px',
                        display: 'flex', alignItems: 'center', gap: '8px',
                        borderBottom: '0.5px solid #f3f4f6',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
                    >
                      <div style={{
                        width: '28px', height: '28px', borderRadius: '6px', background: '#1a4731',
                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '10px', fontWeight: 500, flexShrink: 0,
                      }}>
                        {a.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{a.name}</div>
                        {a.industry && <div style={{ fontSize: '11px', color: '#888' }}>{a.industry}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Contact Search */}
            <div ref={contactRef} style={{ position: 'relative', marginBottom: '10px' }}>
              <input
                type="text"
                value={contactSearch}
                onChange={(e) => { setContactSearch(e.target.value); setContactId(''); setShowContactDD(true); }}
                onFocus={() => { if (contactSearch) setShowContactDD(true); }}
                placeholder={accountId ? `Search contact at ${accountName}...` : 'Search contact (optional)...'}
                style={{
                  width: '100%', padding: '10px 12px', paddingRight: contactSearch ? '32px' : '12px',
                  fontSize: '14px',
                  border: contactId ? '1px solid #1a4731' : '1px solid #e5e7eb',
                  borderRadius: '8px', boxSizing: 'border-box',
                  background: contactId ? '#f0f7ee' : 'white',
                }}
              />
              {contactSearch && (
                <button
                  onClick={() => { setContactSearch(''); setContactId(''); }}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: '16px',
                  }}
                >
                  ×
                </button>
              )}
              {showContactDD && contactSearch && filteredContacts.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, background: 'white',
                  border: '1px solid #e5e7eb', borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10001,
                  maxHeight: '200px', overflowY: 'auto',
                }}>
                  {filteredContacts.map((c) => {
                    const fullName = `${c.firstName} ${c.lastName}`;
                    const acctName = c.accountName || accounts.find((a) => a.id === c.accountId)?.name || '';
                    return (
                      <div
                        key={c.id}
                        onClick={() => {
                          setContactSearch(fullName);
                          setContactId(c.id);
                          setShowContactDD(false);
                          if (!accountId && c.accountId) {
                            setAccountName(acctName);
                            setAccountId(c.accountId);
                            setAccountSearch(acctName);
                          }
                        }}
                        style={{
                          padding: '10px 14px', cursor: 'pointer', fontSize: '13px',
                          display: 'flex', alignItems: 'center', gap: '8px',
                          borderBottom: '0.5px solid #f3f4f6',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
                      >
                        <div style={{
                          width: '28px', height: '28px', borderRadius: '50%', background: '#185FA5',
                          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '10px', fontWeight: 500, flexShrink: 0,
                        }}>
                          {c.firstName?.[0]}{c.lastName?.[0]}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500 }}>
                            {fullName}
                            {c.isKeyMan && <span style={{ color: '#f59e0b', marginLeft: '4px' }}>★</span>}
                          </div>
                          <div style={{ fontSize: '11px', color: '#888' }}>
                            {c.title ? `${c.title} · ` : ''}{acctName}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notes */}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes (optional)"
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', fontSize: '13px',
                border: '1px solid #e5e7eb', borderRadius: '8px',
                marginBottom: '16px', resize: 'none', boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  padding: '8px 16px', borderRadius: '8px',
                  border: '1px solid #e5e7eb', background: 'white',
                  cursor: 'pointer', fontSize: '13px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!subject.trim() || saving || saved}
                style={{
                  padding: '8px 20px', borderRadius: '8px', border: 'none',
                  background: saved ? '#1D9E75' : subject.trim() ? '#1a4731' : '#e5e7eb',
                  color: subject.trim() || saved ? 'white' : '#aaa',
                  cursor: subject.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '13px', fontWeight: 500,
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
